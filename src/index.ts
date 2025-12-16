import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WebSocketServer, WebSocket } from "ws";
import { execa } from "execa";
import fs from "fs/promises";
import path from "path";
import { getHarnessCode } from "./harness.js";

// --- State ---
let activeProcess: any | null = null;
let activeWs: WebSocket | null = null;
let wsServer: WebSocketServer | null = null;
let wsPort: number | null = null;
// Map request ID to promise resolvers
const pendingRequests = new Map<
  string | number,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();
let nextMsgId = 1;
let appStartedResolver: (() => void) | null = null;

// --- Helper Functions ---

// Send JSON-RPC to the Dart harness
async function sendRpc(method: string, params: any) {
  if (!activeWs) throw new Error("App not connected. Use start_app first.");
  const id = `req_${nextMsgId++}`;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    activeWs!.send(JSON.stringify({ jsonrpc: "2.0", method, params, id }));
    
    // Default timeout 30s
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id);
        reject(new Error(`Timeout waiting for device response to ${method}`));
      }
    }, 30000);
  });
}

// Start WebSocket Server
async function startWsServer(): Promise<number> {
  if (wsServer) return wsPort!;
  
  return new Promise((resolve) => {
    wsServer = new WebSocketServer({ port: 0 }); // 0 = random free port
    wsServer.on("listening", () => {
      const addr = wsServer?.address();
      if (typeof addr === 'object' && addr !== null) {
        wsPort = addr.port;
        resolve(wsPort);
      }
    });

    wsServer.on("connection", (ws) => {
      console.error("Device connected via WebSocket");
      activeWs = ws;
      
      ws.on("message", (data) => {
        try {
          const msg = JSON.parse(data.toString());
          
          // Handle responses
          if (msg.id && pendingRequests.has(msg.id)) {
            const { resolve, reject } = pendingRequests.get(msg.id)!;
            pendingRequests.delete(msg.id);
            if (msg.error) {
              reject(new Error(msg.error.message || "Unknown error from device"));
            } else {
              resolve(msg.result);
            }
          }
          
          // Handle notifications
          if (msg.method === 'app.started') {
            if (appStartedResolver) {
              appStartedResolver();
              appStartedResolver = null;
            }
          }
          
        } catch (e) {
          console.error("Error parsing WS message:", e);
        }
      });
      
      ws.on("close", () => {
        console.error("Device disconnected");
        activeWs = null;
      });
    });
  });
}

// Helper to extract package name from pubspec.yaml
async function getPackageName(projectPath: string): Promise<string | undefined> {
    try {
        const pubspecPath = path.join(projectPath, "pubspec.yaml");
        const content = await fs.readFile(pubspecPath, "utf-8");
        const match = content.match(/^name:\s+(\S+)/m);
        return match ? match[1] : undefined;
    } catch (e) {
        return undefined;
    }
}

// --- MCP Server Setup ---

const server = new Server(
  {
    name: "flutter-test-pilot",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Define Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "start_app",
        description: "Injects the harness and starts the Flutter app in test mode.",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string", description: "Absolute path to the Flutter project root" },
            device_id: { type: "string", description: "Device ID (e.g., 'macos', 'chrome', or a simulator ID)" },
          },
          required: ["project_path"],
        },
      },
      {
        name: "stop_app",
        description: "Stops the currently running Flutter app and cleans up.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "validate_project",
        description: "Checks and optionally fixes project prerequisites (dependencies, permissions).",
        inputSchema: {
          type: "object",
          properties: {
            project_path: { type: "string", description: "Absolute path to the Flutter project root" },
            auto_fix: { type: "boolean", description: "Whether to automatically apply fixes" },
          },
          required: ["project_path"],
        },
      },
      {
        name: "tap",
        description: "Taps on a widget identified by the finder.",
        inputSchema: {
          type: "object",
          properties: {
            finderType: {
              type: "string",
              enum: ["byKey", "byText", "byTooltip", "byType"],
              description: "Type of finder to use"
            },
            key: { type: "string", description: "Key value (for byKey)" },
            text: { type: "string", description: "Text to match (for byText)" },
            tooltip: { type: "string", description: "Tooltip message (for byTooltip)" },
            type: { type: "string", description: "Runtime type string (for byType)" },
          },
          required: ["finderType"],
        },
      },
      {
        name: "enter_text",
        description: "Enters text into a widget found by the finder.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "Text to enter" },
            finderType: {
              type: "string",
              enum: ["byKey", "byText", "byTooltip", "byType"],
              description: "Finder type"
            },
            key: { type: "string" },
            // Add other finder props if needed
          },
          required: ["text", "finderType"],
        },
      },
      {
        name: "scroll",
        description: "Scrolls a widget.",
        inputSchema: {
          type: "object",
          properties: {
            finderType: {
              type: "string",
              enum: ["byKey", "byText", "byTooltip", "byType"],
              description: "Finder type"
            },
            key: { type: "string" },
            text: { type: "string" },
            dx: { type: "number", description: "Horizontal scroll delta" },
            dy: { type: "number", description: "Vertical scroll delta" },
          },
          required: ["finderType", "dx", "dy"],
        },
      },
      {
        name: "wait_for",
        description: "Waits for a widget to appear.",
        inputSchema: {
          type: "object",
          properties: {
            finderType: {
              type: "string",
              enum: ["byKey", "byText", "byTooltip", "byType"],
              description: "Finder type"
            },
            key: { type: "string" },
            text: { type: "string" },
            timeout: { type: "number", description: "Timeout in milliseconds" },
          },
          required: ["finderType"],
        },
      },
      {
        name: "get_widget_tree",
        description: "Returns a simplified JSON representation of the widget tree.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "validate_project") {
      const { project_path, auto_fix } = args as { project_path: string; auto_fix?: boolean };
      const report: string[] = [];
      let success = true;

      // 1. Check pubspec.yaml
      const pubspecPath = path.join(project_path, "pubspec.yaml");
      try {
        const pubspecContent = await fs.readFile(pubspecPath, "utf-8");
        
        const hasIntegrationTest = pubspecContent.includes("integration_test:");
        const hasWebSocket = pubspecContent.includes("web_socket_channel:");
        
        if (!hasIntegrationTest) {
            report.push("❌ Missing 'integration_test' in pubspec.yaml.");
            success = false;
            if (auto_fix) {
                await execa("flutter", ["pub", "add", "integration_test", "--sdk=flutter"], { cwd: project_path });
                report.push("✅ Added 'integration_test'.");
            }
        } else {
            report.push("✅ 'integration_test' found.");
        }

        if (!hasWebSocket) {
            report.push("❌ Missing 'web_socket_channel' in pubspec.yaml.");
            success = false;
            if (auto_fix) {
                await execa("flutter", ["pub", "add", "web_socket_channel"], { cwd: project_path });
                report.push("✅ Added 'web_socket_channel'.");
            }
        } else {
            report.push("✅ 'web_socket_channel' found.");
        }
      } catch (e) {
          report.push(`❌ Could not read pubspec.yaml: ${e}`);
          success = false;
      }

      // 2. Check macOS entitlements (if macos folder exists)
      const macosPath = path.join(project_path, "macos/Runner/DebugProfile.entitlements");
      try {
          await fs.access(macosPath); // Throws if not exists
          
          const entitlements = await fs.readFile(macosPath, "utf-8");
          if (!entitlements.includes("com.apple.security.network.client")) {
              report.push("❌ Missing 'com.apple.security.network.client' in DebugProfile.entitlements.");
              success = false;
              if (auto_fix) {
                  const closingDictIndex = entitlements.lastIndexOf("</dict>");
                  if (closingDictIndex !== -1) {
                      const newContent = entitlements.slice(0, closingDictIndex) + 
                                         "\t<key>com.apple.security.network.client</key>\n\t<true/>\n" + 
                                         entitlements.slice(closingDictIndex);
                      await fs.writeFile(macosPath, newContent);
                      report.push("✅ Added network client entitlement to DebugProfile.entitlements.");
                  } else {
                      report.push("⚠️ Could not auto-fix entitlements (structure mismatch).");
                  }
              }
          } else {
              report.push("✅ macOS network client entitlement found.");
          }
      } catch (e) {
          // Ignore if macos folder/file doesn't exist
      }

      return {
          content: [{ type: "text", text: report.join("\n") }],
          isError: !success && !auto_fix 
      };
    }

    if (name === "start_app") {
      const { project_path, device_id } = args as { project_path: string; device_id?: string };
      
      // 1. Start WS Server
      const port = await startWsServer();
      
      // 2. Inject Harness
      const integrationTestDir = path.join(project_path, "integration_test");
      await fs.mkdir(integrationTestDir, { recursive: true });
      
      // Try to determine package name from pubspec.yaml
      const packageName = await getPackageName(project_path);
      const harnessCode = getHarnessCode(packageName);
      
      const harnessPath = path.join(integrationTestDir, "mcp_harness.dart");
      await fs.writeFile(harnessPath, harnessCode);
      
      // 3. Spawn Flutter Process
      const flutterArgs = [
        "test",
        "integration_test/mcp_harness.dart",
        "--dart-define", `WS_URL=ws://localhost:${port}`,
        "--reporter", "json"
      ];
      
      if (device_id) {
        flutterArgs.push("-d", device_id);
      }
      
      console.error(`Spawning: flutter ${flutterArgs.join(" ")}`);
      
      if (activeProcess) {
        activeProcess.kill();
      }
      
      activeProcess = execa("flutter", flutterArgs, {
        cwd: project_path,
        stdio: ["ignore", "pipe", "pipe"], // pipe stdout/stderr to log
      });
      activeProcess.catch((e: any) => {}); // Prevent unhandled rejection
      
      // Stream logs
      activeProcess.stdout?.on("data", (chunk: any) => console.error(`[Flutter]: ${chunk}`));
      activeProcess.stderr?.on("data", (chunk: any) => console.error(`[Flutter Err]: ${chunk}`));

      activeProcess.on("exit", (code: any) => {
        console.error(`Flutter process exited with code ${code}`);
        activeProcess = null;
        activeWs = null;
      });

      // 4. Wait for connection
      console.error("Waiting for app to connect...");
      await new Promise<void>((resolve, reject) => {
        appStartedResolver = resolve;
        setTimeout(() => reject(new Error("Timeout waiting for app to start")), 60000); // 60s timeout for build/launch
      });
      
      return {
        content: [{ type: "text", text: `App started and connected! (Injected harness with package: ${packageName ?? 'unknown'})` }],
      };
    }

    if (name === "stop_app") {
      if (activeProcess) {
        activeProcess.kill();
        activeProcess = null;
      }
      activeWs?.close();
      return { content: [{ type: "text", text: "App stopped." }] };
    }

    if (name === "tap") {
      const result = await sendRpc("tap", args);
      return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (name === "enter_text") {
        const result = await sendRpc("enter_text", args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    
    if (name === "scroll") {
        const result = await sendRpc("scroll", args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (name === "wait_for") {
        const result = await sendRpc("wait_for", args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    
    if (name === "get_widget_tree") {
        const result = await sendRpc("get_widget_tree", {});
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    throw new Error(`Unknown tool: ${name}`);
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
async function main() {
    await server.connect(transport);
}

main().catch(console.error);

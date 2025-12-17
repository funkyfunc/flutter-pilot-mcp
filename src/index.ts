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
import os from "os";
import { getHarnessCode } from "./harness.js";

// --- State ---
let activeProcess: any | null = null;
let activeWs: WebSocket | null = null;
let wsServer: WebSocketServer | null = null;
let wsPort: number | null = null;
let currentObservatoryUri: string | null = null;
let currentAppId: string | null = null;
const logBuffer: string[] = []; // Store logs in memory
const MAX_LOG_BUFFER = 1000;

// Map request ID to promise resolvers
const pendingRequests = new Map<
  string | number,
  { resolve: (val: any) => void; reject: (err: any) => void }
>();
let nextMsgId = 1;
let appStartedResolver: (() => void) | null = null;

// --- Helper Functions ---
function addToLogBuffer(message: string) {
    if (logBuffer.length >= MAX_LOG_BUFFER) {
        logBuffer.shift(); // Remove oldest
    }
    logBuffer.push(message);
}

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
          const strData = data.toString();
          console.error(`[Server] WS Message received: \${strData.substring(0, 200)}...`);
          const msg = JSON.parse(strData);
          
          // Handle responses
          if (msg.id && pendingRequests.has(msg.id)) {
            console.error(`[Server] Resolving request \${msg.id}`);
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
        name: "hot_restart",
        description: "Performs a hot restart of the running app (reloads code and resets state).",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "read_logs",
        description: "Reads the last N lines from the app's stdout/stderr.",
        inputSchema: {
          type: "object",
          properties: {
            lines: { type: "number", description: "Number of lines to read (default 50)" }
          },
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
            action: { 
                type: "string", 
                description: "Optional TextInputAction to perform after entering text (e.g. 'done', 'search', 'next', 'go', 'send')." 
            },
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
        name: "scroll_until_visible",
        description: "Scrolls a scrollable widget until a target widget is visible.",
        inputSchema: {
          type: "object",
          properties: {
            finderType: {
              type: "string",
              enum: ["byKey", "byText", "byTooltip", "byType"],
              description: "Finder type for the TARGET widget"
            },
            key: { type: "string" },
            text: { type: "string" },
            dy: { type: "number", description: "Vertical scroll delta per step (default 50.0)" },
            scrollable: {
                type: "object",
                description: "Optional finder for the scrollable widget",
                properties: {
                    finderType: { type: "string", enum: ["byKey", "byType"] },
                    key: { type: "string" },
                    type: { type: "string" }
                }
            }
          },
          required: ["finderType"],
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
        description: "Returns a JSON representation of the widget tree.",
        inputSchema: {
          type: "object",
          properties: {
            summaryOnly: { type: "boolean", description: "If true, returns a filtered tree hiding layout clutter (Container, Padding, etc.)" }
          },
        },
      },
      {
        name: "get_accessibility_tree",
        description: "Returns the accessibility (semantics) tree.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "take_screenshot",
        description: "Captures a screenshot of the running app.",
        inputSchema: {
          type: "object",
          properties: {
            save_path: { type: "string", description: "Optional path to save the screenshot file (e.g. 'screenshot.png'). If not provided, returns base64." },
            type: { 
                type: "string", 
                enum: ["device", "rasterizer", "skia"], 
                description: "The type of screenshot to retrieve. Defaults to 'device'. 'rasterizer' is often better for specific views." 
            }
          },
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

      // 3. Check Android permissions (if android folder exists)
      const androidDebugManifestPath = path.join(project_path, "android/app/src/debug/AndroidManifest.xml");
      const androidMainManifestPath = path.join(project_path, "android/app/src/main/AndroidManifest.xml");
      try {
          // Check if android folder exists by trying to access main manifest
          await fs.access(androidMainManifestPath);

          let hasInternet = false;
          
          // Check main manifest
          const mainManifest = await fs.readFile(androidMainManifestPath, "utf-8");
          if (mainManifest.includes("android.permission.INTERNET")) {
              hasInternet = true;
          }

          // Check debug manifest if not found in main
          if (!hasInternet) {
              try {
                  const debugManifest = await fs.readFile(androidDebugManifestPath, "utf-8");
                  if (debugManifest.includes("android.permission.INTERNET")) {
                      hasInternet = true;
                  }
              } catch (e) {
                  // Debug manifest might not exist
              }
          }

          if (!hasInternet) {
              report.push("❌ Missing 'android.permission.INTERNET' in AndroidManifest.xml (main or debug).");
              success = false;
              if (auto_fix) {
                  // Try to add to debug manifest
                  try {
                      let debugManifest = "";
                      try {
                          debugManifest = await fs.readFile(androidDebugManifestPath, "utf-8");
                      } catch (e) {
                          // Create if doesn't exist (basic template)
                          debugManifest = '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">\n</manifest>';
                          const debugDir = path.dirname(androidDebugManifestPath);
                          await fs.mkdir(debugDir, { recursive: true });
                      }

                      if (debugManifest.includes("</manifest>")) {
                          const newContent = debugManifest.replace(
                              "</manifest>",
                              '    <uses-permission android:name="android.permission.INTERNET"/>\n</manifest>'
                          );
                          await fs.writeFile(androidDebugManifestPath, newContent);
                          report.push("✅ Added INTERNET permission to debug AndroidManifest.xml.");
                      } else {
                          report.push("⚠️ Could not auto-fix AndroidManifest.xml (structure mismatch).");
                      }
                  } catch (e) {
                      report.push(`⚠️ Failed to auto-fix Android permissions: ${e}`);
                  }
              }
          } else {
              report.push("✅ Android INTERNET permission found.");
          }
      } catch (e) {
          // Ignore if android folder doesn't exist
      }

      // 4. Check Web (if web folder exists)
      const webIndexPath = path.join(project_path, "web/index.html");
      try {
          await fs.access(webIndexPath);
          report.push("✅ Web index.html found.");
      } catch (e) {
          // Ignore if web folder doesn't exist or isn't a web project
      }

      return {
          content: [{ type: "text", text: report.join("\n") }],
          isError: !success && !auto_fix 
      };
    }

    if (name === "start_app") {
      const { project_path, device_id } = args as { project_path: string; device_id?: string };
      
      // Reset state
      currentObservatoryUri = null;
      logBuffer.length = 0; // Clear logs

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
        "run", // Use 'run' instead of 'test' to get observatory URI and support hot restart
        "--machine",
        "--target", "integration_test/mcp_harness.dart",
        "--dart-define", `WS_URL=ws://localhost:${port}`
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
        stdio: ["pipe", "pipe", "pipe"], // pipe stdout/stderr to log
      });
      activeProcess.catch((e: any) => {}); // Prevent unhandled rejection
      
      // Stream logs and parse for Observatory URI
      activeProcess.stdout?.on("data", (chunk: any) => {
          const str = chunk.toString();
          console.error(`[Flutter]: ${str}`);
          addToLogBuffer(str);
          
          // Parse JSON events from flutter run --machine
          const lines = str.split("\n");
          for (const line of lines) {
              const trimmed = line.trim();
              if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
                  try {
                      let events = JSON.parse(line);
                      if (!Array.isArray(events)) {
                          events = [events];
                      }
                      
                      for (const event of events) {
                          if (event.event === "app.debugPort") {
                             if (event.params && event.params.wsUri) {
                                 currentObservatoryUri = event.params.wsUri;
                                 console.error(`Captured Observatory URI: ${currentObservatoryUri}`);
                             }
                          }
                          if (event.event === "app.started") {
                              if (event.params && event.params.appId) {
                                  currentAppId = event.params.appId;
                                  console.error(`Captured App ID: ${currentAppId}`);
                              }
                          }
                      }
                  } catch (e) {
                      // ignore parse errors for non-json lines
                  }
              }
          }
      });
      activeProcess.stderr?.on("data", (chunk: any) => {
        const str = chunk.toString();
        console.error(`[Flutter Err]: ${str}`);
        addToLogBuffer(str);
      });

      activeProcess.on("exit", (code: any) => {
        console.error(`Flutter process exited with code ${code}`);
        activeProcess = null;
        activeWs = null;
        currentObservatoryUri = null;
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
      currentObservatoryUri = null;
      currentAppId = null;
      
      // Clean up screenshots
      const tempDir = path.join(os.tmpdir(), "flutter_pilot_screenshots");
      try {
          await fs.rm(tempDir, { recursive: true, force: true });
      } catch (e) {
          // ignore
      }

      return { content: [{ type: "text", text: "App stopped." }] };
    }

    if (name === "hot_restart") {
        if (!activeProcess) {
            throw new Error("App is not running. Use start_app first.");
        }
        if (!currentAppId) {
            throw new Error("App ID not available. Cannot restart.");
        }
        
        // Send JSON-RPC restart command to flutter run stdin
        // Flutter run --machine expects [ { "method": "app.restart", "params": { "appId": "...", "fullRestart": true }, "id": <id> } ]
        const restartCmd = JSON.stringify([{ 
            "method": "app.restart", 
            "params": { 
                "appId": currentAppId,
                "fullRestart": true 
            }, 
            "id": nextMsgId++ 
        }]) + "\n";
        activeProcess.stdin.write(restartCmd);
        
        console.error("Sent hot restart command.");
        return { content: [{ type: "text", text: "Hot restart command sent." }] };
    }

    if (name === "read_logs") {
        const { lines = 50 } = args as { lines?: number };
        const logs = logBuffer.slice(-lines);
        return { content: [{ type: "text", text: logs.join("") }] };
    }

    if (name === "take_screenshot") {
        const { save_path, type = "device" } = args as { save_path?: string, type?: string };
        
        if (!activeProcess) {
            throw new Error("App is not running. Use start_app first.");
        }
        if (!currentObservatoryUri) {
            throw new Error("Observatory URI not available. Screenshot requires a debug/profile build with VM service enabled.");
        }

        const tempDir = path.join(os.tmpdir(), "flutter_pilot_screenshots");
        await fs.mkdir(tempDir, { recursive: true });
        const tempPath = path.join(tempDir, `screenshot_${Date.now()}.png`);

        console.error(`Taking screenshot via: flutter screenshot --type=${type} --observatory-uri=${currentObservatoryUri} -o ${tempPath}`);
        
        try {
            await execa("flutter", [
                "screenshot",
                `--type=${type}`,
                "--observatory-uri=" + currentObservatoryUri,
                "-o", tempPath
            ]);

            // Check if file exists
            await fs.access(tempPath);

            if (save_path) {
                // Move/copy to requested path
                await fs.copyFile(tempPath, save_path);
                return { content: [{ type: "text", text: `Screenshot saved to ${save_path}` }] };
            } else {
                // Return base64
                const buffer = await fs.readFile(tempPath);
                const base64 = buffer.toString("base64");
                // Cleanup temp file immediately if not saving
                await fs.unlink(tempPath);
                return { 
                    content: [
                        { type: "text", text: "Screenshot captured:" },
                        { type: "image", data: base64, mimeType: "image/png" }
                    ] 
                };
            }
        } catch (e: any) {
            throw new Error(`Failed to take screenshot: ${e.message} \nStderr: ${e.stderr}`);
        }
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

    if (name === "scroll_until_visible") {
        const result = await sendRpc("scroll_until_visible", args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }

    if (name === "wait_for") {
        const result = await sendRpc("wait_for", args);
        return { content: [{ type: "text", text: JSON.stringify(result) }] };
    }
    
    if (name === "get_widget_tree") {
        const result = await sendRpc("get_widget_tree", args);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }

    if (name === "get_accessibility_tree") {
        const result = await sendRpc("get_accessibility_tree", args);
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
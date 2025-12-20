import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.resolve(__dirname, "../src/index.js");
const projectPath = path.resolve(__dirname, "../../test_app");
const screenshotPath = path.resolve(__dirname, "test_screenshot_artifact.png");

// Ensure dist exists (assume build was run)
if (!fs.existsSync(serverPath)) {
    console.error(`Server not found at ${serverPath}. Run 'npm run build' first.`);
    process.exit(1);
}

console.log(`Starting MCP server at ${serverPath}`);
const server = spawn("node", [serverPath], {
  stdio: ["pipe", "pipe", process.stderr],
});

let msgId = 1;
const pending = new Map<number, (msg: any) => void>();

server.stdout.on("data", (data) => {
  const lines = data.toString().split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
    //   console.log(`[Server]: ${JSON.stringify(msg).substring(0, 100)}...`);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
      }
    } catch (e) {}
  }
});

function send(method: string, params: any = {}) {
  const id = msgId++;
  const msg = {
    jsonrpc: "2.0",
    id,
    method,
    params,
  };
  server.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise<any>((resolve) => {
    pending.set(id, resolve);
  });
}

async function run() {
    try {
        console.log("1. Initializing...");
        await send("initialize", {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "verify-screenshot", version: "1.0.0" },
        });

        // Mock notification to acknowledge init
        server.stdin.write(JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/initialized",
            params: {}
        }) + "\n");

        console.log("2. Starting app (this may take a minute)...");
        const startRes = await send("tools/call", {
            name: "start_app",
            arguments: {
                project_path: projectPath,
                device_id: "macos"
            }
        });
        
        if (startRes.error || (startRes.result && startRes.result.isError)) {
            throw new Error(`Failed to start app: ${JSON.stringify(startRes)}`);
        }
        console.log("App started.");

        console.log("3. Taking 'app' screenshot...");
        const shotRes = await send("tools/call", {
            name: "take_screenshot",
            arguments: {
                save_path: screenshotPath,
                type: "app"
            }
        });

        if (shotRes.error || (shotRes.result && shotRes.result.isError)) {
             throw new Error(`Failed to take screenshot: ${JSON.stringify(shotRes)}`);
        }

        console.log(`Screenshot response: ${JSON.stringify(shotRes.result).substring(0, 100)}...`);

        // Verify file
        if (!fs.existsSync(screenshotPath)) {
            throw new Error("Screenshot file was not created!");
        }
        const stats = fs.statSync(screenshotPath);
        if (stats.size === 0) {
            throw new Error("Screenshot file is empty!");
        }
        console.log(`Verified screenshot created at ${screenshotPath} (${stats.size} bytes)`);

        console.log("4. Stopping app...");
        await send("tools/call", {
            name: "stop_app",
            arguments: {}
        });
        console.log("Test Passed!");
        process.exit(0);

    } catch (e) {
        console.error("Test Failed:", e);
        process.exit(1);
    } finally {
        // Cleanup
        if (fs.existsSync(screenshotPath)) {
            fs.unlinkSync(screenshotPath);
        }
        server.kill();
    }
}

run();
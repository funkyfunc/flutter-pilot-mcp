import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface McpResponse {
	id?: number;
	result?: { content?: Array<{ text: string }>; isError?: boolean };
	error?: { message: string };
}

const tempDir = path.join(os.tmpdir(), `flutter_pilot_test_${Date.now()}`);

async function setupDummyProject(): Promise<void> {
	await fs.mkdir(tempDir, { recursive: true });

	await fs.writeFile(
		path.join(tempDir, "pubspec.yaml"),
		`name: dummy_project
description: A new Flutter project.
environment:
  sdk: '>=3.2.0 <4.0.0'
dependencies:
  flutter:
    sdk: flutter
dev_dependencies:
  flutter_test:
    sdk: flutter
`,
	);

	const androidDebugDir = path.join(tempDir, "android/app/src/debug");
	await fs.mkdir(androidDebugDir, { recursive: true });
	await fs.writeFile(
		path.join(androidDebugDir, "AndroidManifest.xml"),
		`<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.dummy">
    <application android:label="dummy_project">
    </application>
</manifest>`,
	);

	const androidMainDir = path.join(tempDir, "android/app/src/main");
	await fs.mkdir(androidMainDir, { recursive: true });
	await fs.writeFile(
		path.join(androidMainDir, "AndroidManifest.xml"),
		`<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.dummy">
</manifest>`,
	);

	console.log(`Created dummy project at: ${tempDir}`);
}

async function cleanup(): Promise<void> {
	try {
		await fs.rm(tempDir, { recursive: true, force: true });
		console.log("Cleaned up temp project.");
	} catch {
		// ignore
	}
}

async function runTest(): Promise<void> {
	await setupDummyProject();

	const serverJsPath = path.join(__dirname, "../dist/index.js");
	console.log(`Starting MCP server at ${serverJsPath}`);

	const server = spawn("node", [serverJsPath], {
		stdio: ["pipe", "pipe", "inherit"],
	});

	let msgId = 1;
	function send(method: string, params: Record<string, unknown> = {}): void {
		const msg = { jsonrpc: "2.0", id: msgId++, method, params };
		server.stdin.write(`${JSON.stringify(msg)}\n`);
	}

	server.stdout.on("data", async (data: Buffer) => {
		const lines = data.toString().split("\n");
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const msg = JSON.parse(line) as McpResponse;
				if (msg.result && msg.id === 1) {
					console.log("Initialized. Running validate_project...");
					send("tools/call", {
						name: "validate_project",
						arguments: { project_path: tempDir, auto_fix: true },
					});
				} else if (msg.result && msg.id === 2) {
					console.log("Validation result received:");
					const output = msg.result.content?.[0]?.text ?? "";
					console.log(output);

					let passed = true;

					const debugManifest = await fs.readFile(
						path.join(tempDir, "android/app/src/debug/AndroidManifest.xml"),
						"utf-8",
					);
					if (debugManifest.includes("android.permission.INTERNET")) {
						console.log(
							"✅ Verified: AndroidManifest.xml was updated with INTERNET permission.",
						);
					} else {
						console.error("❌ Failed: AndroidManifest.xml was NOT updated.");
						passed = false;
					}

					server.kill();
					await cleanup();
					process.exit(passed ? 0 : 1);
				} else if (msg.error) {
					console.error("Error from server:", msg.error);
					server.kill();
					await cleanup();
					process.exit(1);
				}
			} catch {
				// ignore json parse errors
			}
		}
	});

	send("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "test-script", version: "1.0.0" },
	});
}

runTest().catch(async (e) => {
	console.error(e);
	await cleanup();
});

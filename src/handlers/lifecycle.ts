import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
	attachDaemonStreams,
	getFreePort,
	injectHarnessFile,
	spawnFlutterDaemon,
	waitForAppConnection,
} from "../infra/flutter-daemon.js";
import { writeDaemonCommand } from "../infra/rpc.js";
import { connectToHarness } from "../infra/ws-client.js";
import {
	activeAppSession,
	recentDaemonLogs,
	requireSession,
	setActiveAppSession,
} from "../session.js";
import {
	type FlutterDevice,
	GRACEFUL_STOP_TIMEOUT_MS,
	SCREENSHOT_DIR,
} from "../types.js";
import { textResponse } from "../utils.js";
import { stopActiveRecordingIfRunning } from "./recording.js";

export async function handleStartApp(args: {
	project_path: string;
	device_id?: string;
}) {
	const projectPath = args.project_path;
	const deviceId = args.device_id || null;

	recentDaemonLogs.length = 0;

	const port = await getFreePort();
	const packageName = await injectHarnessFile(projectPath);
	const flutterProcess = spawnFlutterDaemon(projectPath, port, deviceId);

	setActiveAppSession({
		process: flutterProcess,
		ws: null,
		appId: null,
		observatoryUri: null,
		projectPath,
		deviceId,
	});

	attachDaemonStreams(flutterProcess);

	// Start connecting to the harness WebSocket server in parallel.
	// The Dart harness starts an HttpServer on the given port, and we
	// retry until it accepts our connection. Once connected, the harness
	// sends an `app.started` notification which resolves the wait below.
	connectToHarness(port).catch((err) => {
		console.error(`WebSocket harness connection failed: ${err}`);
	});

	await waitForAppConnection(flutterProcess);

	return textResponse(
		`App started and connected! (Injected harness with package: ${packageName ?? "unknown"})`,
	);
}

export async function handleStopApp() {
	// Auto-finalize any active recording before tearing down the session.
	// This ensures recordings are saved even if the agent forgets to call stop_recording.
	await stopActiveRecordingIfRunning();

	if (activeAppSession?.appId) {
		try {
			writeDaemonCommand("app.stop", { appId: activeAppSession.appId });
			console.error("Sent app.stop command to Flutter daemon.");
			await new Promise<void>((resolve) => {
				const timeout = setTimeout(() => resolve(), GRACEFUL_STOP_TIMEOUT_MS);
				activeAppSession?.process.on("exit", () => {
					clearTimeout(timeout);
					resolve();
				});
			});
		} catch {
			console.error("Error sending app.stop");
		}
	}

	if (activeAppSession) {
		try {
			activeAppSession.process.kill("SIGKILL");
		} catch {}
	}
	activeAppSession?.ws?.close();

	if (activeAppSession?.projectPath) {
		const name = path.basename(activeAppSession.projectPath);
		await execa("pkill", ["-f", `${name}.*flutter`], { reject: false });
		await execa("pkill", ["-f", `${name}.app`], { reject: false });
	}

	setActiveAppSession(null);

	const tempDir = path.join(os.tmpdir(), SCREENSHOT_DIR);
	try {
		await fs.rm(tempDir, { recursive: true, force: true });
	} catch {}

	return textResponse("App stopped.");
}

export async function handlePilotHotRestart() {
	const s = requireSession();
	if (!s.appId) throw new Error("App ID not available. Cannot restart.");
	writeDaemonCommand("app.restart", { appId: s.appId, fullRestart: true });
	console.error("Sent hot restart command.");

	// After hot restart, the Dart harness restarts and creates a new WS
	// server on the same port. The ws-client auto-reconnects, but we must
	// wait for that reconnection before returning control to the caller.
	const maxWaitMs = 30_000;
	const pollIntervalMs = 250;
	let waited = 0;
	while (!s.ws && waited < maxWaitMs) {
		await new Promise((r) => setTimeout(r, pollIntervalMs));
		waited += pollIntervalMs;
	}

	if (!s.ws) {
		throw new Error(
			"WebSocket did not reconnect after hot restart within timeout.",
		);
	}

	console.error(`Hot restart reconnected after ${waited}ms.`);
	return textResponse("Hot restart completed and reconnected.");
}

export async function handleListDevices() {
	const { stdout } = await execa("flutter", ["devices", "--machine"]);
	const devices = JSON.parse(stdout) as FlutterDevice[];

	if (devices.length === 0) {
		return textResponse(
			"No devices found. Make sure a simulator/emulator is running or a physical device is connected.",
		);
	}

	const summary = devices
		.map(
			(d) =>
				`• ${d.name} (${d.id}) — ${d.targetPlatform}, ${d.isSupported ? "✅ supported" : "❌ unsupported"}`,
		)
		.join("\\n");

	return textResponse(
		`Found ${devices.length} device(s):\\n${summary}\\n\\n` +
			"Use the device ID (e.g. 'macos', 'chrome', or a simulator UUID) with start_app.",
	);
}

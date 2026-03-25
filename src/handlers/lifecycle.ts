import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import {
	attachDaemonStreams,
	injectHarnessFile,
	spawnFlutterDaemon,
	waitForAppConnection,
} from "../infra/flutter-daemon.js";
import { writeDaemonCommand } from "../infra/rpc.js";
import { ensureWsServer } from "../infra/ws-server.js";
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

export async function handleStartApp(args: {
	project_path: string;
	device_id?: string;
}) {
	const projectPath = args.project_path;
	const deviceId = args.device_id || null;

	recentDaemonLogs.length = 0;

	const port = await ensureWsServer();
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
	await waitForAppConnection();

	return textResponse(
		`App started and connected! (Injected harness with package: ${packageName ?? "unknown"})`,
	);
}

export async function handleStopApp() {
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
	return textResponse("Hot restart command sent.");
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

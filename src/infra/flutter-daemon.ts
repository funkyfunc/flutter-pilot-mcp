import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { execa, type Subprocess } from "execa";

import { getHarnessCode } from "../harness/harness.js";
import {
	activeAppSession,
	appendLog,
	recentDaemonLogs,
	setActiveAppSession,
	setAppConnectedResolver,
} from "../session.js";
import { APP_LAUNCH_TIMEOUT_MS, type FlutterDaemonEvent } from "../types.js";

// ─── Pubspec Helpers ────────────────────────────────────────────────────────

export async function readPackageName(
	projectPath: string,
): Promise<string | undefined> {
	try {
		const content = await fs.readFile(
			path.join(projectPath, "pubspec.yaml"),
			"utf-8",
		);
		const match = content.match(/^name:\s+(\S+)/m);
		return match?.[1];
	} catch {
		return undefined;
	}
}

// ─── Port Allocation ────────────────────────────────────────────────────────

/** Get a free port by briefly binding to port 0, capturing the OS-assigned port. */
export function getFreePort(): Promise<number> {
	return new Promise<number>((resolve, reject) => {
		const srv = net.createServer();
		srv.listen(0, () => {
			const addr = srv.address();
			if (typeof addr === "object" && addr !== null) {
				const port = addr.port;
				srv.close(() => resolve(port));
			} else {
				srv.close(() => reject(new Error("Could not determine free port")));
			}
		});
		srv.on("error", reject);
	});
}

// ─── Flutter Daemon Helpers ─────────────────────────────────────────────────

export function parseDaemonEvents(raw: string): FlutterDaemonEvent[] {
	const parsedEvents: FlutterDaemonEvent[] = [];
	for (const line of raw.split("\\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) continue;

		try {
			const data = JSON.parse(trimmed);
			const events = Array.isArray(data) ? data : [data];
			parsedEvents.push(...events);
		} catch {
			// Non-JSON lines are expected (build output, etc.)
		}
	}
	return parsedEvents;
}

export function processDaemonOutput(raw: string): void {
	const events = parseDaemonEvents(raw);
	for (const event of events) {
		if (event.event === "app.debugPort" && event.params?.wsUri) {
			if (activeAppSession)
				activeAppSession.observatoryUri = event.params.wsUri as string;
			console.error(`Captured Observatory URI: ${event.params.wsUri}`);
		}
		if (event.event === "app.started" && event.params?.appId) {
			if (activeAppSession)
				activeAppSession.appId = event.params.appId as string;
			console.error(`Captured App ID: ${event.params.appId}`);
		}
	}
}

// ─── Lifecycle Helpers ──────────────────────────────────────────────────────

export async function injectHarnessFile(
	projectPath: string,
): Promise<string | undefined> {
	const testDir = path.join(projectPath, "integration_test");
	await fs.mkdir(testDir, { recursive: true });

	const packageName = await readPackageName(projectPath);
	await fs.writeFile(
		path.join(testDir, "mcp_harness.dart"),
		getHarnessCode(packageName),
	);
	return packageName;
}

export function spawnFlutterDaemon(
	projectPath: string,
	port: number,
	deviceId: string | null,
): Subprocess {
	const flutterArgs = [
		"run",
		"--machine",
		"--target",
		"integration_test/mcp_harness.dart",
		"--dart-define",
		`WS_PORT=${port}`,
		...(deviceId ? ["-d", deviceId] : []),
	];

	console.error(`Spawning: flutter ${flutterArgs.join(" ")}`);

	if (activeAppSession) activeAppSession.process.kill();

	const flutterDaemonProcess = execa("flutter", flutterArgs, {
		cwd: projectPath,
		stdio: ["pipe", "pipe", "pipe"],
	});
	flutterDaemonProcess.catch(() => {}); // Prevent unhandled rejection on kill
	return flutterDaemonProcess;
}

export function attachDaemonStreams(flutterProcess: Subprocess): void {
	flutterProcess.stdout?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		console.error(`[Flutter]: ${text}`);
		appendLog(text);
		processDaemonOutput(text);
	});

	flutterProcess.stderr?.on("data", (chunk: Buffer) => {
		const text = chunk.toString();
		console.error(`[Flutter Err]: ${text}`);
		appendLog(text);
	});

	flutterProcess.on("exit", (code: number | null) => {
		console.error(`Flutter process exited with code ${code}`);
		setActiveAppSession(null);
	});
}

export async function waitForAppConnection(
	flutterProcess: Subprocess,
): Promise<void> {
	console.error("Waiting for app to connect...");
	return new Promise<void>((resolve, reject) => {
		setAppConnectedResolver(resolve);

		const timeout = setTimeout(
			() => reject(new Error("Timeout waiting for app to start")),
			APP_LAUNCH_TIMEOUT_MS,
		);

		flutterProcess.on("exit", (code: number | null) => {
			if (code !== null && code !== 0) {
				clearTimeout(timeout);
				const recentOutput = recentDaemonLogs.slice(-20).join("\n");
				reject(new Error(`Build failed (exit code ${code}):\n${recentOutput}`));
			}
		});
	});
}

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { execa } from "execa";
import { z } from "zod";
import {
	attachDaemonStreams,
	injectHarnessFile,
	spawnFlutterDaemon,
	waitForAppConnection,
} from "./flutter-daemon.js";
import { sendRpc, writeDaemonCommand } from "./rpc.js";
import {
	activeAppSession,
	recentDaemonLogs,
	requireSession,
	setActiveAppSession,
} from "./session.js";
import {
	type FinderPayload,
	type FlutterDevice,
	GRACEFUL_STOP_TIMEOUT_MS,
	SCREENSHOT_DIR,
	type ScreenshotResult,
	toErrorMessage,
} from "./types.js";
import { ensureWsServer } from "./ws-server.js";

// ─── Selector Parsing ───────────────────────────────────────────────────────

function parseTarget(target: string): FinderPayload {
	if (target.startsWith("#")) {
		return { finderType: "byKey", key: target.substring(1) };
	}

	const eqIndex = target.indexOf("=");
	if (eqIndex > 0) {
		const prefix = target.substring(0, eqIndex).trim();
		const value = target
			.substring(eqIndex + 1)
			.trim()
			.replace(/^['"]|['"]$/g, "");

		switch (prefix) {
			case "text":
				return { finderType: "byText", text: value };
			case "type":
				return { finderType: "byType", type: value };
			case "tooltip":
				return { finderType: "byTooltip", tooltip: value };
			case "id":
				return { finderType: "byId", id: value };
		}
	}

	throw new Error(
		`Invalid target string: '${target}'. ` +
			`Use '#key', 'text="text"', 'type="type"', or 'tooltip="tooltip"'.`,
	);
}

function resolveTargetArgs(
	args: Record<string, unknown>,
): Record<string, unknown> {
	const payload = { ...args };
	if (typeof payload.target === "string") {
		const finder = parseTarget(payload.target);
		delete payload.target;
		Object.assign(payload, finder);
	}
	return payload;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function textResponse(text: string) {
	return { content: [{ type: "text" as const, text }] };
}

function jsonResponse(data: unknown, pretty = false) {
	return {
		content: [
			{
				type: "text" as const,
				text: JSON.stringify(data, null, pretty ? 2 : undefined),
			},
		],
	};
}

/** Forward a command directly to the Dart harness, returning JSON. */
async function forwardToHarness(
	method: string,
	args: Record<string, unknown>,
	pretty = false,
) {
	const payload = resolveTargetArgs(args);
	const result = await sendRpc(method, payload);
	return jsonResponse(result, pretty);
}

// ─── Shared Schema Fragments ────────────────────────────────────────────────

const TARGET_DESCRIPTION =
	"Target string (e.g. '#loginBtn', 'text=\"Submit\"', 'type=\"ElevatedButton\"', 'id=\"123\"')";

const targetShape = {
	target: z.string().describe(TARGET_DESCRIPTION).optional(),
	finderType: z.string().optional(),
	key: z.string().optional(),
	text: z.string().optional(),
	tooltip: z.string().optional(),
	type: z.string().optional(),
};

// ─── Core Handlers ──────────────────────────────────────────────────────────

async function handleStartApp(args: {
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

async function handleStopApp() {
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

async function handlePilotHotRestart() {
	const s = requireSession();
	if (!s.appId) throw new Error("App ID not available. Cannot restart.");
	writeDaemonCommand("app.restart", { appId: s.appId, fullRestart: true });
	console.error("Sent hot restart command.");
	return textResponse("Hot restart command sent.");
}

async function handleListDevices() {
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

async function captureAppRenderScreenshot(savePath?: string) {
	const result = (await sendRpc("screenshot", {})) as ScreenshotResult;
	if (result.error) throw new Error(result.error);

	if (savePath) {
		await fs.writeFile(savePath, Buffer.from(result.data, "base64"));
		return textResponse(`Screenshot saved to ${savePath}`);
	}
	return {
		content: [
			{ type: "text" as const, text: "Screenshot captured:" },
			{ type: "image" as const, data: result.data, mimeType: "image/png" },
		],
	};
}

async function captureNativeDeviceScreenshot(
	currentSession: NonNullable<typeof activeAppSession>,
	screenshotType: string,
	savePath?: string,
) {
	if (!currentSession.observatoryUri) {
		throw new Error(
			"Observatory URI not available. Screenshot requires a debug/profile build with VM service enabled.",
		);
	}

	const tempDir = path.join(os.tmpdir(), SCREENSHOT_DIR);
	await fs.mkdir(tempDir, { recursive: true });
	const tempPath = path.join(tempDir, `screenshot_${Date.now()}.png`);

	const screenshotArgs = [
		"screenshot",
		`--type=${screenshotType}`,
		"-o",
		tempPath,
	];
	if (screenshotType !== "device")
		screenshotArgs.push(`--vm-service-url=${currentSession.observatoryUri}`);
	if (currentSession.deviceId)
		screenshotArgs.push("-d", currentSession.deviceId);

	console.error(`Taking screenshot via: flutter ${screenshotArgs.join(" ")}`);

	try {
		await execa("flutter", screenshotArgs, { cwd: currentSession.projectPath });
	} catch (flutterErr) {
		if (currentSession.deviceId === "macos" && screenshotType === "device") {
			console.error(
				"Flutter screenshot failed, falling back to macOS screencapture...",
			);
			await execa("screencapture", ["-x", tempPath]);
		} else {
			throw flutterErr;
		}
	}

	await fs.access(tempPath);

	if (savePath) {
		await fs.copyFile(tempPath, savePath);
		return textResponse(`Screenshot saved to ${savePath}`);
	}

	const buffer = await fs.readFile(tempPath);
	await fs.unlink(tempPath);
	return {
		content: [
			{ type: "text" as const, text: "Screenshot captured:" },
			{
				type: "image" as const,
				data: buffer.toString("base64"),
				mimeType: "image/png",
			},
		],
	};
}

async function handleTakeScreenshot(args: {
	save_path?: string;
	type?: string;
}) {
	const currentSession = requireSession();
	const savePath = args.save_path;
	const screenshotType = args.type || "app";

	if (screenshotType === "app") {
		return captureAppRenderScreenshot(savePath);
	}
	return captureNativeDeviceScreenshot(
		currentSession,
		screenshotType,
		savePath,
	);
}

// ─── Environment Helpers ────────────────────────────────────────────────────

async function handleSimulateBackground(args: { duration_ms?: number }) {
	const durationMs = args.duration_ms ?? 2000;
	const deviceId = activeAppSession?.deviceId;

	if (deviceId?.includes("-")) {
		try {
			await execa("xcrun", [
				"simctl",
				"launch",
				deviceId,
				"com.apple.springboard",
			]);
			await new Promise((r) => setTimeout(r, durationMs));
		} catch {}
		return textResponse(
			"Simulated backgrounding via simctl (Note: resuming might require manual tap if bundle ID is unknown)",
		);
	}

	if (deviceId?.startsWith("emulator-")) {
		try {
			await execa("adb", [
				"-s",
				deviceId,
				"shell",
				"input",
				"keyevent",
				"KEYCODE_HOME",
			]);
			await new Promise((r) => setTimeout(r, durationMs));
		} catch {}
		return textResponse("Simulated backgrounding via adb");
	}

	return textResponse("Device not supported for simulate_background");
}

async function handleSetNetworkStatus(args: { wifi: boolean }) {
	const { wifi } = args;
	const deviceId = activeAppSession?.deviceId;

	if (deviceId?.includes("-")) {
		return textResponse(
			"Network toggling in iOS simulators is complex and usually requires external proxies. " +
				"Consider using 'intercept_network' instead.",
		);
	}

	if (deviceId?.startsWith("emulator-")) {
		await execa("adb", [
			"-s",
			deviceId,
			"shell",
			"svc",
			"wifi",
			wifi ? "enable" : "disable",
		]);
		return textResponse(`Set WiFi to ${wifi} via adb`);
	}

	return textResponse("Device not supported for set_network_status");
}

async function checkPubspecDependencies(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const pubspecPath = path.join(projectPath, "pubspec.yaml");
	try {
		const pubspec = await fs.readFile(pubspecPath, "utf-8");
		let success = true;

		for (const [dep, fixArgs] of [
			["integration_test", ["pub", "add", "integration_test", "--sdk=flutter"]],
			["web_socket_channel", ["pub", "add", "web_socket_channel"]],
		] as const) {
			if (!pubspec.includes(`${dep}:`)) {
				report.push(`❌ Missing '${dep}' in pubspec.yaml.`);
				success = false;
				if (autoFix) {
					await execa("flutter", [...fixArgs], { cwd: projectPath });
					report.push(`✅ Added '${dep}'.`);
				}
			} else {
				report.push(`✅ '${dep}' found.`);
			}
		}
		return success;
	} catch (e) {
		report.push(`❌ Could not read pubspec.yaml: ${toErrorMessage(e)}`);
		return false;
	}
}

async function checkMacOsEntitlements(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const entitlementsPath = path.join(
		projectPath,
		"macos/Runner/DebugProfile.entitlements",
	);
	try {
		await fs.access(entitlementsPath);
	} catch {
		return true; // skip
	}

	const content = await fs.readFile(entitlementsPath, "utf-8");
	if (content.includes("com.apple.security.network.client")) {
		report.push("✅ macOS network client entitlement found.");
		return true;
	}

	report.push(
		"❌ Missing 'com.apple.security.network.client' in DebugProfile.entitlements.",
	);
	if (!autoFix) return false;

	const idx = content.lastIndexOf("</dict>");
	if (idx !== -1) {
		const patched =
			content.slice(0, idx) +
			"\\t<key>com.apple.security.network.client</key>\\n\\t<true/>\\n" +
			content.slice(idx);
		await fs.writeFile(entitlementsPath, patched);
		report.push(
			"✅ Added network client entitlement to DebugProfile.entitlements.",
		);
		return true;
	}
	report.push("⚠️ Could not auto-fix entitlements (structure mismatch).");
	return false;
}

async function checkAndroidPermissions(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const androidMain = path.join(
		projectPath,
		"android/app/src/main/AndroidManifest.xml",
	);
	const androidDebug = path.join(
		projectPath,
		"android/app/src/debug/AndroidManifest.xml",
	);

	try {
		await fs.access(androidMain);
	} catch {
		return true; // skip
	}

	const mainManifest = await fs.readFile(androidMain, "utf-8");
	let hasInternet = mainManifest.includes("android.permission.INTERNET");

	if (!hasInternet) {
		try {
			const debugManifest = await fs.readFile(androidDebug, "utf-8");
			hasInternet = debugManifest.includes("android.permission.INTERNET");
		} catch {}
	}

	if (hasInternet) {
		report.push("✅ Android INTERNET permission found.");
		return true;
	}

	report.push(
		"❌ Missing 'android.permission.INTERNET' in AndroidManifest.xml (main or debug).",
	);
	if (!autoFix) return false;

	try {
		let debugContent: string;
		try {
			debugContent = await fs.readFile(androidDebug, "utf-8");
		} catch {
			debugContent =
				'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">\\n</manifest>';
			await fs.mkdir(path.dirname(androidDebug), { recursive: true });
		}

		if (debugContent.includes("</manifest>")) {
			const patched = debugContent.replace(
				"</manifest>",
				'    <uses-permission android:name="android.permission.INTERNET"/>\\n</manifest>',
			);
			await fs.writeFile(androidDebug, patched);
			report.push("✅ Added INTERNET permission to debug AndroidManifest.xml.");
			return true;
		}

		report.push(
			"⚠️ Could not auto-fix AndroidManifest.xml (structure mismatch).",
		);
		return false;
	} catch (e) {
		report.push(
			`⚠️ Failed to auto-fix Android permissions: ${toErrorMessage(e)}`,
		);
		return false;
	}
}

async function ensureHarnessInGitignore(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const gitignorePath = path.join(projectPath, ".gitignore");
	try {
		await fs.access(gitignorePath);
	} catch {
		return true; // skip
	}

	const gitignore = await fs.readFile(gitignorePath, "utf-8");
	if (gitignore.includes("integration_test/mcp_harness.dart")) {
		return true;
	}

	if (autoFix) {
		await fs.appendFile(
			gitignorePath,
			"\\n# Flutter Pilot MCP Harness\\nintegration_test/mcp_harness.dart\\n",
		);
		report.push("✅ Added 'integration_test/mcp_harness.dart' to .gitignore.");
		return true;
	}

	report.push("❌ Missing 'integration_test/mcp_harness.dart' in .gitignore.");
	return false;
}

async function handleValidateProject(args: {
	project_path: string;
	auto_fix?: boolean;
}) {
	const projectPath = args.project_path;
	const autoFix = args.auto_fix ?? false;
	const report: string[] = [];

	const pubspecOk = await checkPubspecDependencies(
		projectPath,
		autoFix,
		report,
	);
	const macosOk = await checkMacOsEntitlements(projectPath, autoFix, report);
	const androidOk = await checkAndroidPermissions(projectPath, autoFix, report);

	try {
		await fs.access(path.join(projectPath, "web/index.html"));
		report.push("✅ Web index.html found.");
	} catch {}

	const gitignoreOk = await ensureHarnessInGitignore(
		projectPath,
		autoFix,
		report,
	);
	const success = pubspecOk && macosOk && androidOk && gitignoreOk;

	return {
		content: [{ type: "text" as const, text: report.join("\\n") }],
		isError: !success && !autoFix,
	};
}

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerTools(server: McpServer) {
	// Lifecycle
	server.registerTool(
		"start_app",
		{
			description:
				"Injects the harness and starts the Flutter app in test mode.",
			inputSchema: {
				project_path: z
					.string()
					.describe("Absolute path to the Flutter project root"),
				device_id: z
					.string()
					.optional()
					.describe("Device ID (e.g., 'macos', 'chrome', or a simulator ID)"),
			},
		},
		handleStartApp,
	);

	server.registerTool(
		"stop_app",
		{ description: "Stops the currently running Flutter app and cleans up." },
		handleStopApp,
	);

	server.registerTool(
		"pilot_hot_restart",
		{
			description:
				"Performs a hot restart of the currently running app session started by this server.",
		},
		handlePilotHotRestart,
	);

	server.registerTool(
		"list_devices",
		{
			description:
				"Lists available Flutter devices. Does NOT require a running app.",
		},
		handleListDevices,
	);

	// Interaction
	server.registerTool(
		"tap",
		{
			description: "Taps on a widget identified by the target string.",
			inputSchema: targetShape,
		},
		async (args) => forwardToHarness("tap", args),
	);
	server.registerTool(
		"long_press",
		{ description: "Long presses on a widget.", inputSchema: targetShape },
		async (args) => forwardToHarness("long_press", args),
	);
	server.registerTool(
		"double_tap",
		{ description: "Double taps on a widget.", inputSchema: targetShape },
		async (args) => forwardToHarness("double_tap", args),
	);
	server.registerTool(
		"enter_text",
		{
			description: "Enters text into a widget found by the target string.",
			inputSchema: {
				...targetShape,
				text: z.string().describe("Text to enter"),
				action: z
					.string()
					.optional()
					.describe("Optional TextInputAction to perform after entering text"),
			},
		},
		async (args) => forwardToHarness("enter_text", args),
	);
	server.registerTool(
		"scroll",
		{
			description: "Scrolls a widget by exact pixel deltas.",
			inputSchema: {
				...targetShape,
				dx: z.number().describe("Horizontal scroll delta"),
				dy: z.number().describe("Vertical scroll delta"),
			},
		},
		async (args) => forwardToHarness("scroll", args),
	);
	server.registerTool(
		"swipe",
		{
			description:
				"Swipes a widget in a named direction (simpler than scroll for common gestures).",
			inputSchema: {
				...targetShape,
				direction: z
					.enum(["up", "down", "left", "right"])
					.describe("Swipe direction"),
				distance: z
					.number()
					.optional()
					.describe("Swipe distance in pixels (default 300)"),
			},
		},
		async (args) => forwardToHarness("swipe", args),
	);
	server.registerTool(
		"scroll_until_visible",
		{
			description:
				"Scrolls a scrollable widget until a target widget is visible.",
			inputSchema: {
				...targetShape,
				scrollable_target: z
					.string()
					.optional()
					.describe("Optional target string for the scrollable container"),
				dy: z
					.number()
					.optional()
					.describe("Vertical scroll delta per step (default 50.0)"),
			},
		},
		async (args) => {
			const payload = resolveTargetArgs(args);
			if (typeof payload.scrollable_target === "string") {
				payload.scrollable = parseTarget(payload.scrollable_target);
				delete payload.scrollable_target;
			}
			const result = await sendRpc("scroll_until_visible", payload);
			return jsonResponse(result);
		},
	);
	server.registerTool(
		"navigate_to",
		{
			description: "Pushes a named route using the root Navigator.",
			inputSchema: { route: z.string().describe("Named route to navigate to") },
		},
		async (args) => forwardToHarness("navigate_to", args),
	);
	server.registerTool(
		"go_back",
		{
			description:
				"Pops the current route off the Navigator stack (like pressing the back button).",
		},
		async () => {
			const result = await sendRpc("go_back", {});
			return jsonResponse(result);
		},
	);
	server.registerTool(
		"get_current_route",
		{
			description:
				"Returns the name of the currently active route on the Navigator stack.",
		},
		async () => {
			const result = await sendRpc("get_current_route", {});
			return jsonResponse(result);
		},
	);
	server.registerTool(
		"press_key",
		{
			description:
				"Simulates a keyboard key press (e.g. enter, tab, escape, backspace, arrow keys).",
			inputSchema: {
				key: z
					.string()
					.describe(
						"Key name: enter, tab, escape, backspace, delete, space, arrowUp, arrowDown, arrowLeft, arrowRight, home, end, pageUp, pageDown",
					),
			},
		},
		async (args) => forwardToHarness("press_key", args),
	);

	// Verification
	server.registerTool(
		"assert_exists",
		{
			description: "Returns { success: true } if the target exists.",
			inputSchema: targetShape,
		},
		async (args) => forwardToHarness("assert_exists", args),
	);
	server.registerTool(
		"assert_not_exists",
		{
			description: "Returns { success: true } if the target does NOT exist.",
			inputSchema: targetShape,
		},
		async (args) => forwardToHarness("assert_not_exists", args),
	);
	server.registerTool(
		"assert_text_equals",
		{
			description: "Returns { success: true } if the target text matches.",
			inputSchema: { ...targetShape, expectedText: z.string() },
		},
		async (args) => forwardToHarness("assert_text_equals", args),
	);
	server.registerTool(
		"assert_state",
		{
			description: "Returns { success: true } if the target state matches.",
			inputSchema: {
				...targetShape,
				stateKey: z.string().describe("e.g. 'value', 'groupValue'"),
				expectedValue: z.boolean().describe("Expected bool value"),
			},
		},
		async (args) => forwardToHarness("assert_state", args),
	);

	// Inspection
	server.registerTool(
		"take_screenshot",
		{
			description: "Captures a screenshot of the running app.",
			inputSchema: {
				save_path: z
					.string()
					.optional()
					.describe(
						"Optional path to save the screenshot file. If not provided, returns base64.",
					),
				type: z
					.enum(["app", "device", "skia"])
					.optional()
					.describe("The type of screenshot to retrieve."),
			},
		},
		handleTakeScreenshot,
	);
	server.registerTool(
		"screenshot_element",
		{
			description:
				"Captures a screenshot of a specific widget (returns base64 PNG).",
			inputSchema: {
				...targetShape,
				save_path: z
					.string()
					.optional()
					.describe("Optional path to save the screenshot file"),
			},
		},
		async (args) => {
			const payload = resolveTargetArgs(args);
			const savePath =
				typeof payload.save_path === "string" ? payload.save_path : undefined;
			delete payload.save_path;
			const result = (await sendRpc(
				"screenshot_element",
				payload,
			)) as ScreenshotResult;
			if (result.error) throw new Error(result.error);
			if (savePath) {
				await fs.writeFile(savePath, Buffer.from(result.data, "base64"));
				return textResponse(`Element screenshot saved to ${savePath}`);
			}
			return {
				content: [
					{ type: "text" as const, text: "Element screenshot captured:" },
					{
						type: "image" as const,
						data: result.data,
						mimeType: "image/png",
					},
				],
			};
		},
	);
	server.registerTool(
		"get_widget_tree",
		{
			description: "Returns a JSON representation of the widget tree.",
			inputSchema: {
				summaryOnly: z
					.boolean()
					.optional()
					.describe("If true, returns a filtered tree"),
			},
		},
		async (args) => forwardToHarness("get_widget_tree", args),
	);
	server.registerTool(
		"get_accessibility_tree",
		{
			description: "Returns the accessibility (semantics) tree.",
			inputSchema: {
				includeRect: z
					.boolean()
					.optional()
					.describe("Include bounding rect for visual intersection"),
			},
		},
		async (args) => forwardToHarness("get_accessibility_tree", args),
	);
	server.registerTool(
		"explore_screen",
		{ description: "Maps out interactive elements on the screen." },
		async (args) => forwardToHarness("explore_screen", args),
	);
	server.registerTool(
		"wait_for",
		{
			description: "Waits for a widget to appear.",
			inputSchema: {
				...targetShape,
				timeout: z.number().optional().describe("Timeout in milliseconds"),
			},
		},
		async (args) => forwardToHarness("wait_for", args),
	);
	server.registerTool(
		"wait_for_gone",
		{
			description:
				"Waits for a widget to disappear (e.g. a loading spinner or dismissing dialog).",
			inputSchema: {
				...targetShape,
				timeout: z.number().optional().describe("Timeout in milliseconds"),
			},
		},
		async (args) => forwardToHarness("wait_for_gone", args),
	);

	// Environment
	server.registerTool(
		"simulate_background",
		{
			description:
				"Simulates the app going into the background and coming back to the foreground.",
			inputSchema: {
				duration_ms: z
					.number()
					.optional()
					.describe("How long to keep the app in the background"),
			},
		},
		handleSimulateBackground,
	);
	server.registerTool(
		"set_network_status",
		{
			description: "Simulates network connectivity changes.",
			inputSchema: { wifi: z.boolean().describe("Enable or disable WiFi") },
		},
		handleSetNetworkStatus,
	);
	server.registerTool(
		"intercept_network",
		{
			description: "Mocks a network response. Pass null for both to clear.",
			inputSchema: {
				urlPattern: z.string().optional(),
				responseBody: z.string().optional(),
			},
		},
		async (args) => forwardToHarness("intercept_network", args),
	);

	// Utility
	server.registerTool(
		"read_logs",
		{
			description: "Reads the last N lines from the app's stdout/stderr.",
			inputSchema: {
				lines: z
					.number()
					.optional()
					.describe("Number of lines to read (default 50)"),
			},
		},
		async (args) => {
			const count = args.lines ?? 50;
			return textResponse(recentDaemonLogs.slice(-count).join("\\n"));
		},
	);
	server.registerTool(
		"validate_project",
		{
			description: "Checks and optionally fixes project prerequisites.",
			inputSchema: {
				project_path: z
					.string()
					.describe("Absolute path to the Flutter project root"),
				auto_fix: z
					.boolean()
					.optional()
					.describe("Whether to automatically apply fixes"),
			},
		},
		handleValidateProject,
	);
}

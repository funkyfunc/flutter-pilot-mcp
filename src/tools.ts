import fs from "node:fs/promises";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
	handleSetNetworkStatus,
	handleSimulateBackground,
} from "./handlers/environment.js";
import {
	handleListDevices,
	handlePilotHotRestart,
	handleStartApp,
	handleStopApp,
} from "./handlers/lifecycle.js";
import { handleTakeScreenshot } from "./handlers/screenshot.js";
import { handleValidateProject } from "./handlers/validation.js";
import { sendRpc } from "./infra/rpc.js";
import { recentDaemonLogs } from "./session.js";
import type { ScreenshotResult } from "./types.js";

// ─── Selector Parsing ───────────────────────────────────────────────────────

import { jsonResponse, parseTarget, textResponse } from "./utils.js";

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
		"get_text",
		{
			description:
				"Returns the text content of a widget identified by the target string.",
			inputSchema: targetShape,
		},
		async (args) => forwardToHarness("get_text", args),
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
		"drag_and_drop",
		{
			description:
				"Drags from a source widget to a target widget (or to an offset).",
			inputSchema: {
				from: z.string().describe("Target string for the starting widget"),
				to: z
					.string()
					.optional()
					.describe("Optional target string for the destination widget"),
				dx: z.number().optional().describe("Optional horizontal drag delta"),
				dy: z.number().optional().describe("Optional vertical drag delta"),
				duration_ms: z
					.number()
					.optional()
					.describe("Optional duration of the drag animation"),
			},
		},
		async (args) => {
			const payload: Record<string, unknown> = { ...args };
			if (typeof payload.from === "string") {
				payload.from = parseTarget(payload.from);
			}
			if (typeof payload.to === "string") {
				payload.to = parseTarget(payload.to);
			}
			const result = await sendRpc("drag_and_drop", payload);
			return jsonResponse(result);
		},
	);
	server.registerTool(
		"wipe_app_data",
		{
			description:
				"Wipes app data (clears app documents, support, and temporary directories).",
		},
		async () => {
			const result = await sendRpc("wipe_app_data", {});
			return jsonResponse(result);
		},
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

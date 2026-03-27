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
import { handleScreenshot } from "./handlers/screenshot.js";
import { handleValidateProject } from "./handlers/validation.js";
import { sendRpc } from "./infra/rpc.js";
import { recentDaemonLogs } from "./session.js";
import { jsonResponse, parseTarget, textResponse } from "./utils.js";

// ─── Selector Parsing ───────────────────────────────────────────────────────

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
	"Target string (e.g. '#loginBtn', 'text=\"Submit\"', 'type=\"ElevatedButton\"', 'semanticsLabel=\"Username\"')";

const targetShape = {
	target: z.string().describe(TARGET_DESCRIPTION).optional(),
	timeout_ms: z
		.number()
		.optional()
		.describe("Implicit wait timeout in milliseconds before failing"),
};

// ─── Tool Registration ──────────────────────────────────────────────────────

export function registerTools(server: McpServer) {
	// ── Lifecycle ─────────────────────────────────────────────────────────────
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

	// ── Interaction ───────────────────────────────────────────────────────────
	server.registerTool(
		"tap",
		{
			description:
				"Taps, long-presses, or double-taps a widget. Defaults to a normal tap. Use gesture to change.",
			inputSchema: {
				...targetShape,
				gesture: z
					.enum(["tap", "long_press", "double"])
					.optional()
					.describe(
						"Gesture type: 'tap' (default), 'long_press', or 'double' for double-tap",
					),
			},
		},
		async (args) => forwardToHarness("tap", args),
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
		"get_text",
		{
			description:
				"Returns the text content of a widget identified by the target string.",
			inputSchema: targetShape,
		},
		async (args) => forwardToHarness("get_text", args),
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
			description:
				"Scrolls or swipes a widget. Use dx/dy for pixel-precise scrolling, or direction/distance for named swipe gestures.",
			inputSchema: {
				...targetShape,
				dx: z.number().optional().describe("Horizontal scroll delta in pixels"),
				dy: z.number().optional().describe("Vertical scroll delta in pixels"),
				direction: z
					.enum(["up", "down", "left", "right"])
					.optional()
					.describe(
						"Swipe direction (alternative to dx/dy). When set, dx/dy are computed automatically.",
					),
				distance: z
					.number()
					.optional()
					.describe(
						"Swipe distance in pixels when using direction (default 300)",
					),
			},
		},
		async (args) => forwardToHarness("scroll", args),
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
				dx: z
					.number()
					.optional()
					.describe("Horizontal scroll delta per step (default 0.0)"),
				dy: z
					.number()
					.optional()
					.describe("Vertical scroll delta per step (default -50.0)"),
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
			description:
				"Pushes a named route using Navigator.pushNamed. NOTE: Does NOT work with GoRouter or other custom routers — use tap() to navigate via on-screen elements instead.",
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

	// ── Assertions ────────────────────────────────────────────────────────────
	server.registerTool(
		"assert",
		{
			description:
				"Runs an assertion check on a widget. Use 'check' to specify the type: exists, not_exists, text_equals, state, visible, or enabled.",
			inputSchema: {
				...targetShape,
				check: z
					.enum([
						"exists",
						"not_exists",
						"text_equals",
						"state",
						"visible",
						"enabled",
					])
					.describe("Type of assertion to perform"),
				expected: z
					.union([z.string(), z.boolean()])
					.optional()
					.describe(
						"Expected value. Required for text_equals (string) and enabled (boolean).",
					),
				stateKey: z
					.string()
					.optional()
					.describe(
						"Widget state property to check (e.g. 'value', 'groupValue'). Required for check='state'.",
					),
			},
		},
		async (args) => {
			const payload = resolveTargetArgs(args);
			// Map 'expected' to the field names the harness expects
			const check = payload.check as string;
			if (check === "text_equals" && payload.expected !== undefined) {
				payload.expectedText = payload.expected;
				delete payload.expected;
			}
			if (check === "state" && payload.expected !== undefined) {
				payload.expectedValue = payload.expected;
				delete payload.expected;
			}
			const result = await sendRpc("assert", payload);
			return jsonResponse(result);
		},
	);

	// ── Inspection ────────────────────────────────────────────────────────────
	server.registerTool(
		"screenshot",
		{
			description:
				"Captures a screenshot. Without a target, captures the full app. With a target, captures a specific widget.",
			inputSchema: {
				...targetShape,
				save_path: z
					.string()
					.optional()
					.describe(
						"Optional path to save the screenshot file. If not provided, returns base64.",
					),
				type: z
					.enum(["app", "device", "skia"])
					.optional()
					.describe(
						"Screenshot type (only for full-app screenshots). Defaults to 'app'.",
					),
			},
		},
		handleScreenshot,
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
		{
			description: "Maps out interactive elements on the screen.",
			inputSchema: {
				filter: z
					.array(z.string())
					.optional()
					.describe(
						"List of flags to require (e.g. 'isButton', 'isTextField')",
					),
				within: z
					.string()
					.optional()
					.describe(
						"Target string to constrain exploration to a specific subtree",
					),
			},
		},
		async (args) => {
			const payload: Record<string, unknown> = { ...args };
			if (typeof payload.within === "string") {
				payload.within = parseTarget(payload.within);
			}
			const result = await forwardToHarness("explore_screen", payload, false);
			if (args.filter && Array.isArray(args.filter) && args.filter.length > 0) {
				try {
					const textContent = result.content[0] as {
						type: "text";
						text: string;
					};
					const data = JSON.parse(textContent.text);
					if (data.elements) {
						data.elements = data.elements.filter((el: any) => {
							const flags = el.flags || [];
							const isMatch = args.filter?.some(
								(f: string) =>
									flags.includes(f) ||
									(f === "isButton" &&
										el.actions?.includes("tap") &&
										!flags.includes("isTextField")),
							);
							return isMatch;
						});
						data.interactive_elements_count = data.elements.length;
						textContent.text = JSON.stringify(data, null, 2);
					}
				} catch (_e) {
					// pass
				}
			}
			return result;
		},
	);

	// ── Waits ─────────────────────────────────────────────────────────────────
	server.registerTool(
		"wait_for",
		{
			description:
				"Waits for a widget to appear or disappear. Set gone=true to wait for disappearance (e.g. loading spinners).",
			inputSchema: {
				...targetShape,
				timeout: z.number().optional().describe("Timeout in milliseconds"),
				gone: z
					.boolean()
					.optional()
					.describe(
						"If true, waits for the widget to disappear instead of appear",
					),
			},
		},
		async (args) => forwardToHarness("wait_for", args),
	);

	// ── Environment ───────────────────────────────────────────────────────────
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

	// ── Utility ───────────────────────────────────────────────────────────────
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

	// ── Composite Actions ─────────────────────────────────────────────────────
	server.registerTool(
		"batch_actions",
		{
			description:
				"Execute multiple actions in a single call. Each action is run sequentially with pumpAndSettle between them. Stops on first error. Supported tools: tap, enter_text, scroll, assert, wait_for, press_key, screenshot, get_text, explore_screen.",
			inputSchema: {
				actions: z
					.array(
						z.object({
							tool: z.string().describe("Tool name to execute"),
							args: z
								.record(z.string(), z.unknown())
								.describe("Arguments for the tool"),
						}),
					)
					.describe("Array of actions to execute sequentially"),
			},
		},
		async (args) => {
			const actions = args.actions as Array<{
				tool: string;
				args: Record<string, unknown>;
			}>;
			// Resolve target strings and map assert fields in each action's args before forwarding
			const resolvedActions = actions.map((action) => {
				const resolved = resolveTargetArgs(action.args);
				// Map assert expected/expectedText/expectedValue for harness compatibility
				if (action.tool === "assert") {
					const check = resolved.check as string | undefined;
					if (check === "text_equals" && resolved.expected !== undefined) {
						resolved.expectedText = resolved.expected;
						delete resolved.expected;
					}
					if (check === "state" && resolved.expected !== undefined) {
						resolved.expectedValue = resolved.expected;
						delete resolved.expected;
					}
				}
				return {
					tool: action.tool,
					args: resolved,
				};
			});
			const batchTimeoutMs = 30_000 + resolvedActions.length * 10_000;
			const result = await sendRpc(
				"batch_actions",
				{ actions: resolvedActions },
				batchTimeoutMs,
			);
			return jsonResponse(result);
		},
	);

	// ── Animation ─────────────────────────────────────────────────────────────
	server.registerTool(
		"wait_for_animation",
		{
			description:
				"Pumps frames for a specified duration without waiting for all animations to settle. Useful for hero transitions, page animations, or custom animation controllers where pumpAndSettle would time out.",
			inputSchema: {
				duration_ms: z
					.number()
					.optional()
					.describe(
						"Duration in milliseconds to pump frames (default 500). Frames are pumped at ~60fps.",
					),
			},
		},
		async (args) => forwardToHarness("wait_for_animation", args),
	);
}

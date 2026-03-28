/**
 * Smoke test: verifies the tool list schema is correct.
 * Does NOT boot the test app — runs in under a second.
 */

import { parseTarget } from "../src/utils.js";
import { createClient, type McpTool } from "./helpers.js";

function testParseTarget(): boolean {
	const cases = [
		{ input: "#myBtn", expected: { finderType: "byKey", key: "myBtn" } },
		{
			input: 'text="Submit"',
			expected: { finderType: "byText", text: "Submit" },
		},
		{
			input: "text='Submit'",
			expected: { finderType: "byText", text: "Submit" },
		},
		{
			input: "text=`Submit`",
			expected: { finderType: "byText", text: "Submit" },
		},
		{
			input: "text=Submit",
			expected: { finderType: "byText", text: "Submit" },
		},
		{
			input: 'type="ElevatedButton"',
			expected: { finderType: "byType", type: "ElevatedButton" },
		},
		{
			input: 'tooltip="Back"',
			expected: { finderType: "byTooltip", tooltip: "Back" },
		},
		{ input: "Submit", expected: { finderType: "byText", text: "Submit" } },
		{
			input: 'semanticsLabel="Log Food" index=0',
			expected: {
				finderType: "bySemanticsLabel",
				semanticsLabel: "Log Food",
				index: 0,
			},
		},
		{
			input: 'text="Submit" index=2',
			expected: { finderType: "byText", text: "Submit", index: 2 },
		},
	];

	let passed = true;
	for (const tc of cases) {
		const result = parseTarget(tc.input);
		if (JSON.stringify(result) !== JSON.stringify(tc.expected)) {
			console.error(
				`❌ parseTarget('${tc.input}') failed. Expected ${JSON.stringify(
					tc.expected,
				)}, got ${JSON.stringify(result)}`,
			);
			passed = false;
		}
	}
	if (passed) console.log("✅ parseTarget tests passed.");
	return passed;
}

const EXPECTED_TOOLS = [
	"start_app",
	"stop_app",
	"pilot_hot_restart",
	"list_devices",
	"tap",
	"enter_text",
	"scroll",
	"scroll_until_visible",
	"wait_for",
	"press_key",
	"get_text",
	"drag_and_drop",
	"get_widget_tree",
	"get_accessibility_tree",
	"explore_screen",
	"screenshot",
	"assert",
	"navigate_to",
	"go_back",
	"get_current_route",
	"intercept_network",
	"simulate_background",
	"set_network_status",
	"read_logs",
	"batch_actions",
	"wait_for_animation",
];

async function main(): Promise<void> {
	const client = createClient();

	const _res = await client.send("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "verify-tools", version: "1.0.0" },
	});

	const listRes = await client.send("tools/list", {});
	const tools = listRes.result?.tools ?? [];
	const toolNames = new Set(tools.map((t: McpTool) => t.name));

	let passed = true;
	for (const expected of EXPECTED_TOOLS) {
		if (!toolNames.has(expected)) {
			console.error(`❌ Missing tool: ${expected}`);
			passed = false;
		}
	}

	// Check that old tool names are NOT present (consolidation verification)
	const REMOVED_TOOLS = [
		"long_press",
		"double_tap",
		"swipe",
		"wait_for_gone",
		"take_screenshot",
		"screenshot_element",
		"assert_exists",
		"assert_not_exists",
		"assert_text_equals",
		"assert_state",
		"assert_visible",
		"assert_enabled",
		"wipe_app_data",
		"validate_project",
	];
	for (const removed of REMOVED_TOOLS) {
		if (toolNames.has(removed)) {
			console.error(`❌ Tool should have been removed: ${removed}`);
			passed = false;
		}
	}

	// Spot-check consolidated tool schemas
	const tapTool = tools.find((t: McpTool) => t.name === "tap");
	if (!tapTool?.inputSchema?.properties?.gesture) {
		console.error("❌ tap tool missing 'gesture' property");
		passed = false;
	}

	const assertTool = tools.find((t: McpTool) => t.name === "assert");
	if (!assertTool?.inputSchema?.properties?.check) {
		console.error("❌ assert tool missing 'check' property");
		passed = false;
	}

	const scrollTool = tools.find((t: McpTool) => t.name === "scroll");
	if (!scrollTool?.inputSchema?.properties?.direction) {
		console.error("❌ scroll tool missing 'direction' property");
		passed = false;
	}

	const waitForTool = tools.find((t: McpTool) => t.name === "wait_for");
	if (!waitForTool?.inputSchema?.properties?.gone) {
		console.error("❌ wait_for tool missing 'gone' property");
		passed = false;
	}

	const screenshotTool = tools.find((t: McpTool) => t.name === "screenshot");
	if (!screenshotTool?.inputSchema?.properties?.target) {
		console.error("❌ screenshot tool missing 'target' property");
		passed = false;
	}

	if (passed) {
		console.log(
			`✅ All ${EXPECTED_TOOLS.length} expected tools found with correct schemas. ${REMOVED_TOOLS.length} old tools confirmed removed.`,
		);
	}

	const parseTargetPassed = testParseTarget();
	passed = passed && parseTargetPassed;

	client.cleanup();
	process.exit(passed ? 0 : 1);
}

main();

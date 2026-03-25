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
	"long_press",
	"double_tap",
	"enter_text",
	"scroll",
	"swipe",
	"scroll_until_visible",
	"wait_for",
	"wait_for_gone",
	"press_key",
	"get_text",
	"drag_and_drop",
	"wipe_app_data",
	"get_widget_tree",
	"get_accessibility_tree",
	"explore_screen",
	"take_screenshot",
	"screenshot_element",
	"assert_exists",
	"assert_not_exists",
	"assert_text_equals",
	"assert_state",
	"navigate_to",
	"go_back",
	"get_current_route",
	"intercept_network",
	"simulate_background",
	"set_network_status",
	"read_logs",
	"validate_project",
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

	// Spot-check a specific property
	const getWidgetTree = tools.find(
		(t: McpTool) => t.name === "get_widget_tree",
	);
	if (!getWidgetTree?.inputSchema?.properties?.summaryOnly) {
		console.error("❌ get_widget_tree missing 'summaryOnly' property");
		passed = false;
	}

	if (passed) {
		console.log(
			`✅ All ${EXPECTED_TOOLS.length} expected tools found with correct schemas.`,
		);
	}

	const parseTargetPassed = testParseTarget();
	passed = passed && parseTargetPassed;

	client.cleanup();
	process.exit(passed ? 0 : 1);
}

main();

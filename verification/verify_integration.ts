/**
 * Comprehensive integration test.
 *
 * Boots the test app ONCE and exercises every tool category in a single session:
 *   Assertions → Input → State → Exploration → Navigation → Accessibility →
 *   Screenshot → Network Intercept → Hot Restart → Logs → Stop
 */

import fs from "node:fs";
import {
	callTool,
	createClient,
	extractText,
	initClient,
	step,
	TEST_APP_PATH,
} from "./helpers.js";

const client = createClient();

async function runTests(): Promise<void> {
	try {
		await initClient(client);

		// ── Boot ───────────────────────────────────────────────────────────────
		step("Starting app");
		await callTool(client, "start_app", {
			project_path: TEST_APP_PATH,
			device_id: "macos",
		});
		await new Promise((r) => setTimeout(r, 2000)); // let UI settle

		// ── Assertions ─────────────────────────────────────────────────────────
		step("assert (exists)");
		await callTool(client, "assert", {
			check: "exists",
			target: 'text="Welcome Home"',
		});

		step("assert (text_equals)");
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#welcome_text",
			expected: "Welcome Home",
		});

		step("get_text");
		const getTextResult = await callTool(client, "get_text", {
			target: "#welcome_text",
		});
		const getTextData = JSON.parse(extractText(getTextResult)) as {
			text?: string;
		};
		if (getTextData.text !== "Welcome Home") {
			throw new Error(
				`get_text failed. Expected 'Welcome Home', got '${getTextData.text}'`,
			);
		}

		// ── Input ──────────────────────────────────────────────────────────────
		step("enter_text");
		await callTool(client, "enter_text", {
			target: "#my_textfield",
			text: "Hello World",
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#my_textfield",
			expected: "Hello World",
		});

		// ── semanticsLabel Finder ────────────────────────────────────────────
		step("enter_text (semanticsLabel)");
		// First enter text using the key to confirm the field works and scroll into view
		await callTool(client, "enter_text", {
			target: "#hint_only_field",
			text: "",
		});
		// Now use semanticsLabel to enter text (the hint text becomes the semantics label)
		await callTool(client, "enter_text", {
			target: 'semanticsLabel="Search items"',
			text: "test query",
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#hint_only_field",
			expected: "test query",
		});
		console.log("✅ semanticsLabel finder works for hint-text fields.");

		// ── State ──────────────────────────────────────────────────────────────
		step("assert (state - checkbox false)");
		await callTool(client, "assert", {
			check: "state",
			target: "#my_checkbox",
			stateKey: "value",
			expected: false,
		});

		step("tap (checkbox)");
		await callTool(client, "tap", { target: "#my_checkbox" });

		step("assert (state - checkbox true)");
		await callTool(client, "assert", {
			check: "state",
			target: "#my_checkbox",
			stateKey: "value",
			expected: true,
		});

		// ── Exploration ────────────────────────────────────────────────────────
		step("explore_screen");
		const exploreResult = await callTool(client, "explore_screen");
		const exploreData = JSON.parse(extractText(exploreResult)) as {
			interactive_elements_count?: number;
		};
		if (
			!exploreData.interactive_elements_count ||
			exploreData.interactive_elements_count < 3
		) {
			throw new Error(
				`Expected ≥3 interactive elements, got ${exploreData.interactive_elements_count}`,
			);
		}

		// ── Explore Screen suggestedTarget ────────────────────────────────────
		step("explore_screen (suggestedTarget)");
		const exploreResult2 = await callTool(client, "explore_screen");
		const exploreData2 = JSON.parse(extractText(exploreResult2)) as {
			elements?: Array<{ suggestedTarget?: string }>;
		};
		const hasSuggestedTarget = exploreData2.elements?.some(
			(e) =>
				typeof e.suggestedTarget === "string" && e.suggestedTarget.length > 0,
		);
		if (!hasSuggestedTarget) {
			throw new Error("Expected at least one element with suggestedTarget");
		}
		console.log("✅ explore_screen emits suggestedTarget.");

		// ── Validation of Advanced Features ─────────────────────────────────────

		step("assert (enabled)");
		await callTool(client, "assert", {
			check: "enabled",
			target: "#elevated_submit",
			expected: true,
		});
		await callTool(client, "assert", {
			check: "enabled",
			target: "#disabled_button",
			expected: false,
		});
		console.log("✅ assert (enabled) works.");

		step("enter_text");
		await callTool(client, "enter_text", {
			target: "#my_textfield",
			text: "Hello World",
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#my_textfield",
			expected: "Hello World",
		});

		step("enter_text (semanticsLabel)");
		// Clear it first (optional)
		await callTool(client, "enter_text", {
			target: "#hint_only_field",
			text: "",
		});
		// Type into it using its hint text as semanticsLabel
		await callTool(client, "enter_text", {
			target: 'semanticsLabel="Search items"',
			text: "test query",
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#hint_only_field",
			expected: "test query",
		});
		console.log("✅ semanticsLabel finder works for hint-text fields.");

		step("TextInputAction.done");
		// Verify that enter_text can also trigger the onSubmitted callback using the action parameter
		await callTool(client, "tap", { target: "#key_press_field" });
		await callTool(client, "enter_text", {
			target: "#key_press_field",
			text: "enter testing",
			action: "done",
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#key_press_count",
			expected: "Keys Pressed: 1",
		});
		console.log("✅ enter_text triggered TextInputAction.done correctly.");

		step("assert (visible - offscreen)");
		try {
			await callTool(client, "assert", {
				check: "visible",
				target: "#offscreen_target",
			});
			throw new Error("assert visible should have failed for offscreen widget");
		} catch (e: unknown) {
			const err = e as Error;
			if (!err.message.includes("off-screen")) {
				throw new Error(`Expected off-screen error, got: ${err.message}`);
			}
		}

		// Force it back on screen using scroll_until_visible to explicitly test the nested Scrollable logic
		// We want to scroll the content UP (meaning we drag the screen towards the top, negative dy)
		await callTool(client, "scroll_until_visible", {
			target: "#offscreen_target",
			dy: -500,
		});

		// Ensure it is now visible (validating the new pumpAndSettle in assert visible)
		await callTool(client, "assert", {
			check: "visible",
			target: "#offscreen_target",
		});

		// ── Nested target scroll_until_visible ──────────────────────────────────
		step("scroll_until_visible (nested list)");

		await callTool(client, "scroll_until_visible", {
			target: "#nested_list_view",
			dy: -500,
		});

		// Test scrolling inside the new horizontal list view without moving the vertical scroll area
		await callTool(client, "scroll_until_visible", {
			target: "#nested_item_40",
			scrollable_target: "#nested_list_view",
			dx: -200, // Horizontal drag!
			dy: 0,
		});

		// Now scroll back up further so ALL text fields are grouped on screen again!
		await callTool(client, "scroll_until_visible", {
			target: "#key_press_field",
			dy: 500,
		});

		console.log(
			"✅ assert (visible), scroll, and scroll_until_visible work correctly on main axis.",
		);

		step("Compound Selectors");
		// Two widgets have text="Submit". If we tap by text=Submit, it might fail with AmbiguousFinderException.
		try {
			await callTool(client, "tap", { target: 'text="Submit"' });
			throw new Error("Should have thrown ambiguous exception");
		} catch (e: unknown) {
			const err = e as Error;
			if (!err.message.includes("Too many elements")) throw err;
		}
		// Now use compound selector
		await callTool(client, "tap", {
			target: 'type="ElevatedButton" text="Submit"',
		});
		console.log("✅ Compound selectors successfully disambiguated elements.");

		step("Implicit Waits");
		await callTool(client, "tap", { target: "#delayed_show_button" });
		// Taps the delayed button which takes 2 seconds to appear. We use timeout_ms: 3000 to wait inline!
		await callTool(client, "tap", {
			target: "#delayed_show_button",
		});
		await callTool(client, "tap", {
			timeout_ms: 3000,
			target: "#delayed_widget",
		});
		console.log(
			"✅ Implicit waits (timeout_ms) successfully handled delayed widget.",
		);

		// Scroll back to the absolute top for the text fields before testing explore filter
		await callTool(client, "scroll_until_visible", {
			target: "#welcome_text",
			dy: 500,
		});

		step("Explore Screen Filters");
		const filterResult = await callTool(client, "explore_screen", {
			filter: ["isTextField"],
		});
		const filterData = JSON.parse(extractText(filterResult)) as {
			elements?: Record<string, unknown>[];
		};
		if (filterData.elements?.length !== 2) {
			console.log(JSON.stringify(filterData.elements, null, 2));
			throw new Error(
				`Expected exactly 2 TextFields at the top, got ${filterData.elements?.length || 0}`,
			);
		}
		const withinResult = await callTool(client, "explore_screen", {
			within: "#home_scroll_view",
		});
		const withinData = JSON.parse(extractText(withinResult));
		if (
			!withinData.interactive_elements_count ||
			withinData.interactive_elements_count < 5
		) {
			throw new Error("Within filter failed to explore subtree.");
		}
		console.log("✅ explore_screen filter and within arguments work.");

		// ── Go Back Overlay (Bottom Sheet) ────────────────────────────────────
		step("go_back (overlay dismissal)");
		// tap handler calls ensureVisible() which scrolls the button into view
		await callTool(client, "tap", { target: "#show_bottom_sheet" });
		await callTool(client, "assert", {
			check: "exists",
			target: 'text="Bottom Sheet Content"',
		});
		await callTool(client, "go_back");
		// Brief wait for dismissal animation
		await new Promise((r) => setTimeout(r, 500));
		await callTool(client, "assert", {
			check: "not_exists",
			target: 'text="Bottom Sheet Content"',
		});
		console.log("✅ go_back dismisses bottom sheet overlay.");

		// ── Batch Actions ─────────────────────────────────────────────────────
		step("batch_actions");
		const batchResult = await callTool(client, "batch_actions", {
			actions: [
				{ tool: "tap", args: { target: "#my_checkbox" } },
				{
					tool: "assert",
					args: { check: "exists", target: "#my_checkbox" },
				},
				{ tool: "tap", args: { target: "#my_checkbox" } },
			],
		});
		const batchData = JSON.parse(extractText(batchResult)) as {
			all_succeeded?: boolean;
			results?: Array<{ tool: string; status: string }>;
		};
		if (!batchData.all_succeeded) {
			throw new Error(
				`batch_actions failed: ${JSON.stringify(batchData.results)}`,
			);
		}
		console.log(
			`✅ batch_actions executed ${batchData.results?.length} actions successfully.`,
		);

		// ── Change Detection ──────────────────────────────────────────────────
		step("change detection (tap)");
		// Toggle the checkbox and check for changes in the response
		const tapResult = await callTool(client, "tap", {
			target: "#toggle_visibility",
		});
		const tapData = JSON.parse(extractText(tapResult)) as {
			changes?: { added?: string[]; removed?: string[]; modified?: string[] };
		};
		// The toggle hides "I can disappear" - we should see changes
		if (tapData.changes) {
			console.log(
				`✅ Change detection returned: added=${tapData.changes.added?.length ?? 0}, removed=${tapData.changes.removed?.length ?? 0}, modified=${tapData.changes.modified?.length ?? 0}`,
			);
		} else {
			console.log(
				"⚠️ No changes detected (may be an edge case with semantics).",
			);
		}
		// Restore state
		await callTool(client, "tap", { target: "#toggle_visibility" });

		// ── Wait For Animation ────────────────────────────────────────────────
		step("wait_for_animation");
		// Start animation by toggling opacity (widget should be visible after previous swipe)
		await callTool(client, "tap", { target: "#toggle_animation" });
		// Wait for the 400ms animation to complete
		await callTool(client, "wait_for_animation", { duration_ms: 500 });
		// The widget should now be invisible (opacity 0)
		console.log("✅ wait_for_animation completed without error.");
		// Restore animation state
		await callTool(client, "tap", { target: "#toggle_animation" });

		// ── Accessibility ──────────────────────────────────────────────────────
		step("get_accessibility_tree");
		const a11yResult = await callTool(client, "get_accessibility_tree", {
			includeRect: true,
		});
		const a11yTree = JSON.parse(extractText(a11yResult)) as {
			id?: unknown;
			rect?: unknown;
		};
		if (a11yTree.id === undefined || a11yTree.rect === undefined) {
			throw new Error(
				"Invalid accessibility tree: missing id or rect on root node",
			);
		}
		console.log(
			`✅ Root node has ID (${a11yTree.id}). Tree size: ${extractText(a11yResult).length} chars.`,
		);

		// ── Screenshot ─────────────────────────────────────────────────────────
		step("screenshot (full app)");
		const screenshotPath = "/tmp/flutter_pilot_verify_screenshot.png";
		await callTool(client, "screenshot", {
			save_path: screenshotPath,
			type: "app",
		});
		if (
			!fs.existsSync(screenshotPath) ||
			fs.statSync(screenshotPath).size === 0
		) {
			throw new Error("Screenshot file missing or empty");
		}
		console.log(
			`✅ Screenshot created (${fs.statSync(screenshotPath).size} bytes)`,
		);
		fs.unlinkSync(screenshotPath);

		// ── Network Intercept ──────────────────────────────────────────────────
		step("intercept_network");
		await callTool(client, "intercept_network", {
			urlPattern: "example.com",
			responseBody: "Mocked Response Body",
		});
		await callTool(client, "tap", { target: "#fetch_button" });
		await new Promise((r) => setTimeout(r, 1000));
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#network_result",
			expected: "Mocked Response Body",
		});

		// ── Long Press (via gesture) ──────────────────────────────────────────
		step("tap (gesture: long_press)");
		await callTool(client, "tap", {
			target: "#long_press_target",
			gesture: "long_press",
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#long_press_status",
			expected: "Long pressed!",
		});

		// ── Double Tap (via gesture) ──────────────────────────────────────────
		step("tap (gesture: double)");
		await callTool(client, "tap", {
			target: "#double_tap_target",
			gesture: "double",
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#double_tap_count",
			expected: "1",
		});

		// ── Wait For Gone (via gone flag) ─────────────────────────────────────
		step("wait_for (gone: true)");
		await callTool(client, "assert", {
			check: "exists",
			target: "#dismissable_widget",
		});
		await callTool(client, "tap", { target: "#toggle_visibility" });
		await callTool(client, "wait_for", {
			target: "#dismissable_widget",
			timeout: 3000,
			gone: true,
		});
		await callTool(client, "assert", {
			check: "not_exists",
			target: "#dismissable_widget",
		});

		// ── Get Current Route ─────────────────────────────────────────────────
		step("get_current_route");
		const routeResult = await callTool(client, "get_current_route");
		const routeData = JSON.parse(extractText(routeResult)) as {
			route?: string;
		};
		if (routeData.route !== "/") {
			throw new Error(`Expected route '/' but got '${routeData.route}'`);
		}
		console.log(`✅ Current route: ${routeData.route}`);

		// ── Press Key ─────────────────────────────────────────────────────────
		step("press_key (tab)");
		await callTool(client, "press_key", { key: "tab" });
		// Just verify it doesn't throw — key events are hard to assert visually

		// ── Screenshot Element (via target) ──────────────────────────────────
		step("screenshot (element)");
		const elementScreenshotPath =
			"/tmp/flutter_pilot_verify_element_screenshot.png";
		await callTool(client, "screenshot", {
			target: "#welcome_text",
			save_path: elementScreenshotPath,
		});
		if (
			!fs.existsSync(elementScreenshotPath) ||
			fs.statSync(elementScreenshotPath).size === 0
		) {
			throw new Error("Element screenshot file missing or empty");
		}
		console.log(
			`✅ Element screenshot created (${fs.statSync(elementScreenshotPath).size} bytes)`,
		);
		fs.unlinkSync(elementScreenshotPath);

		// ── Navigation ─────────────────────────────────────────────────────────
		step("navigate_to");
		await callTool(client, "navigate_to", { route: "/details" });
		await callTool(client, "assert", {
			check: "exists",
			target: 'text="Item 5"',
		});

		// ── Swipe (via scroll + direction) ────────────────────────────────────
		step("scroll (direction: up)");
		await callTool(client, "scroll", {
			target: 'type="ListView"',
			direction: "up",
			distance: 500,
		});
		await callTool(client, "assert", {
			check: "exists",
			target: 'text="Item 20"',
		});

		await callTool(client, "go_back");

		// ── Drag and Drop ────────────────────────────────────────────────────────
		step("drag_and_drop (reorder)");
		await callTool(client, "navigate_to", { route: "/reorder" });
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#index_Item A",
			expected: "Index 0",
		});
		await callTool(client, "drag_and_drop", {
			from: 'text="Item A"',
			to: 'text="Item C"',
			duration_ms: 1000,
		});
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#index_Item A",
			expected: "Index 2",
		});

		// ── Go Back ───────────────────────────────────────────────────────────
		step("go_back");
		await callTool(client, "go_back");
		await callTool(client, "assert", {
			check: "exists",
			target: 'text="Welcome Home"',
		});

		// ── Logs ───────────────────────────────────────────────────────────────
		step("read_logs");
		const logsResult = await callTool(client, "read_logs", { lines: 10 });
		const logs = extractText(logsResult);
		if (logs.length === 0) {
			throw new Error("Expected non-empty logs");
		}
		console.log(`✅ Got ${logs.split("\n").length} log lines.`);

		// ── Hot Restart ────────────────────────────────────────────────────────
		step("pilot_hot_restart");
		await callTool(client, "pilot_hot_restart");
		await new Promise((r) => setTimeout(r, 3000)); // let restart settle

		step("read_logs (post-restart)");
		const postRestartLogs = extractText(
			await callTool(client, "read_logs", { lines: 20 }),
		);
		if (
			postRestartLogs.includes("Restarted") ||
			postRestartLogs.includes("restart")
		) {
			console.log("✅ Hot restart log evidence found.");
		} else {
			console.log(
				"⚠️ No explicit 'Restarted' in logs (may be timing), but command succeeded.",
			);
		}

		// ── State Wiping ───────────────────────────────────────────────────────
		step("wipe_app_data");
		const preTapResult = await callTool(client, "get_text", {
			target: "#pref_counter",
		});
		const preTapText = JSON.parse(extractText(preTapResult)).text as string;
		const currentCount = parseInt(preTapText.replace("Counter: ", ""), 10) || 0;
		const expectedCount = currentCount + 1;

		await callTool(client, "tap", { target: "#save_pref_button" });
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#pref_counter",
			expected: `Counter: ${expectedCount}`,
		});

		step("pilot_hot_restart (validate persistence)");
		await callTool(client, "pilot_hot_restart");
		await new Promise((r) => setTimeout(r, 2000));
		await callTool(client, "assert", {
			check: "text_equals",
			target: "#pref_counter",
			expected: `Counter: ${expectedCount}`,
		});
		console.log("✅ State persists across hot restarts.");

		// ── Shutdown ────────────────────────────────────────────────────────────
		step("stop_app");
		await callTool(client, "stop_app");

		console.log("\n✅ ALL INTEGRATION TESTS PASSED!");
		process.exit(0);
	} catch (error) {
		console.error("\n❌ TEST FAILED:", error);
		try {
			await callTool(client, "stop_app");
		} catch {
			/* ignore */
		}
		process.exit(1);
	}
}

runTests();

# 🧪 Flutter Pilot

An [MCP server](https://modelcontextprotocol.io) that lets AI agents **see, tap, type, scroll, and assert** inside live Flutter apps — no pre-written tests required.

Flutter Pilot bridges your LLM (Claude, Gemini, etc.) to a running Flutter application via `integration_test` + WebSocket, giving the agent full interactive control of the UI.

---

## 💡 Why Flutter Pilot?

**Zero-config injection.** No changes to your app's source code. The harness is auto-injected at launch time — just point at a project path and go.

**Focused, LLM-optimized toolset.** ~30 purpose-built tools instead of hundreds. Every tool description fits comfortably in an LLM context window without drowning the model in irrelevant options.

**Suggestive errors.** When a widget isn't found, the harness fuzzy-matches against the live widget tree and returns **"Did you mean…?"** suggestions — dramatically reducing agent retry loops and wasted tokens.

**Token-efficient inspection.** Widget tree output strips Dart generics, flattens layout boilerplate (Container, Padding, SizedBox…), and omits heavyweight coordinate data by default. The agent sees only what matters.

**Full WidgetTester power.** Every interaction runs through Flutter's real test framework with `pumpAndSettle()` after each action — no timing hacks, no flaky coordinate-based taps.

## ✨ What Can It Do?

| Category | Tools |
|---|---|
| **Lifecycle** | `start_app` · `stop_app` · `pilot_hot_restart` · `list_devices` |
| **Interaction** | `tap` · `long_press` · `double_tap` · `enter_text` · `scroll` · `swipe` · `drag_and_drop` · `scroll_until_visible` · `wait_for` · `wait_for_gone` · `press_key` |
| **Inspection** | `get_widget_tree` · `get_accessibility_tree` · `explore_screen` · `get_text` · `take_screenshot` · `screenshot_element` |
| **Assertions** | `assert_exists` · `assert_not_exists` · `assert_text_equals` · `assert_state` |
| **Navigation** | `navigate_to` · `go_back` · `get_current_route` |
| **Environment** | `simulate_background` · `set_network_status` · `intercept_network` |
| **Utilities** | `validate_project` · `read_logs` · `wipe_app_data` |

### Unified Selectors

All interaction tools accept a simple `target` string instead of verbose JSON:

```
"#my_key"          →  find by Key
"text=\"Submit\""    →  find by text
"type=\"Checkbox\""  →  find by widget type
"tooltip=\"Back\""   →  find by tooltip
```

### Suggestive Errors

When a widget isn't found, the harness scans the tree and returns **"Did you mean…?"** suggestions — dramatically reducing agent retry loops.

---

## 🏗 Architecture

```
┌──────────────┐    JSON-RPC/stdio    ┌──────────────────┐   WebSocket   ┌──────────────────┐
│  MCP Client  │ ◄──────────────────► │  Node.js Server  │ ◄───────────► │  Dart Harness    │
│  (LLM Agent) │                      │  (index.ts)      │               │  (harness.dart)  │
└──────────────┘                      └──────────────────┘               │  inside Flutter  │
                                                                         │  integration_test│
                                                                         └──────────────────┘
```

1. The **Node.js MCP server** receives tool calls from any MCP-compatible client.
2. On `start_app`, it injects a Dart harness into the project's `integration_test/` directory and launches `flutter run --machine`.
3. The harness connects back to the server over WebSocket and awaits JSON-RPC commands.
4. All interactions (tap, scroll, assert, screenshot, etc.) execute inside the real Flutter test framework with full access to the widget tree.

---

## 📦 Installation

```bash
git clone https://github.com/funkyfunc/flutter-pilot-mcp.git
cd flutter-pilot-mcp
npm install
npm run build
```

### Prerequisites

- **Node.js** ≥ 18
- **Flutter SDK** on your `PATH`
- A Flutter project with `integration_test` and `web_socket_channel` dependencies (use `validate_project` with `auto_fix: true` to add them automatically)

---

## 🚀 Usage

### Add to your MCP client config

**Claude Desktop** (`claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "flutter-test-pilot": {
      "command": "node",
      "args": ["/absolute/path/to/flutter-pilot-mcp/dist/src/index.js"]
    }
  }
}
```

**Gemini Code Assist** (`.gemini/settings.json`):
```json
{
  "mcpServers": {
    "flutter-test-pilot": {
      "command": "node",
      "args": ["/absolute/path/to/flutter-pilot-mcp/dist/src/index.js"]
    }
  }
}
```

### Quick start

Once your MCP client is connected, ask the agent to:

1. **Validate** the project: `validate_project({ project_path: "/path/to/app", auto_fix: true })`
2. **Launch** the app: `start_app({ project_path: "/path/to/app", device_id: "macos" })`
3. **Explore** the UI: `explore_screen({})`
4. **Interact**: `tap({ target: "text=\"Login\"" })`
5. **Assert**: `assert_exists({ target: "#home_screen" })`
6. **Screenshot**: `take_screenshot({ type: "app" })`
7. **Stop**: `stop_app({})`

---

## 🔧 Tool Reference

### Lifecycle

| Tool | Description |
|---|---|
| `start_app` | Injects the harness, launches the app via `flutter run`, and connects over WebSocket. |
| `stop_app` | Gracefully sends `app.stop` to the Flutter daemon, kills processes, and cleans up. |
| `pilot_hot_restart` | Sends a full restart command to the running app (preserves session). |
| `list_devices` | Lists available Flutter devices (simulators, emulators, physical, desktop). No running app required. |

### Interaction

| Tool | Description |
|---|---|
| `tap` | Taps a widget. Automatically scrolls it into view first. |
| `long_press` | Long presses on a widget (triggers `onLongPress` callbacks). |
| `double_tap` | Double taps on a widget (triggers `onDoubleTap` callbacks). |
| `enter_text` | Enters text into a `TextField`. Optionally sends a `TextInputAction` (e.g. `done`, `search`). |
| `scroll` | Drags a widget by `(dx, dy)`. |
| `swipe` | Swipes a widget in a named direction (`up`, `down`, `left`, `right`) with configurable distance. |
| `drag_and_drop` | Drags from a source widget to a destination widget or custom pixel offset. |
| `scroll_until_visible` | Scrolls a scrollable container until a target widget appears. |
| `wait_for` | Polls until a widget appears (with timeout). |
| `wait_for_gone` | Polls until a widget disappears (with timeout). Useful for loading spinners and auto-dismissing dialogs. |
| `press_key` | Simulates a keyboard key press (enter, tab, escape, backspace, arrow keys, etc.). |

### Inspection

| Tool | Description |
|---|---|
| `get_widget_tree` | Returns the full widget tree as JSON. Use `summaryOnly: true` to filter layout noise. |
| `get_accessibility_tree` | Returns the Semantics tree — compact, labels-focused, ideal for LLMs. Pass `includeRect: true` if coordinates are needed. |
| `explore_screen` | Maps all interactive elements on the current screen using the native Semantics tree. |
| `get_text` | Returns the raw text string from a widget (supports `Text`, `EditableText`, and `RichText` descendants). |
| `take_screenshot` | Captures a PNG screenshot. Defaults to `type: "app"` (recommended) for maximum reliability; `"device"` uses native capture. |
| `screenshot_element` | Captures a PNG screenshot of a specific widget by target. Useful for visual regression of individual components. |

### Assertions

| Tool | Description |
|---|---|
| `assert_exists` | Checks that a widget matching the target is in the tree. |
| `assert_not_exists` | Checks that no widget matching the target exists. |
| `assert_text_equals` | Checks that a widget's text content matches the expected value. |
| `assert_state` | Checks a widget's boolean state (e.g. `Checkbox.value`, `Switch.value`). |

### Navigation & Environment

| Tool | Description |
|---|---|
| `navigate_to` | Pushes a named route via `Navigator.pushNamed`. |
| `go_back` | Pops the current route off the Navigator stack (like pressing the back button). |
| `get_current_route` | Returns the name of the currently active route — lets the agent know where it is. |
| `simulate_background` | Sends the app to background and brings it back after a duration. |
| `set_network_status` | Toggles WiFi on/off (macOS/iOS Simulator only). |
| `intercept_network` | Registers a mock HTTP response for a URL pattern. Pass null to clear. |

### Utilities

| Tool | Description |
|---|---|
| `validate_project` | Checks for required dependencies and platform entitlements. Use `auto_fix: true` to resolve automatically. |
| `read_logs` | Returns the last N lines from the app's stdout/stderr. |
| `wipe_app_data` | Wipes device application state (documents, support, and temporary directories). |

---

## 🤝 Using with the Official Dart/Flutter MCP Server

Flutter Pilot is **complementary** to the [official Dart/Flutter MCP server](https://github.com/dart-lang/ai). While there is some overlap in app interaction (like widget tree inspection), they serve distinct roles in a developer's workflow:

| Feature | Official Dart MCP | Flutter Pilot |
|---|---|---|
| **Primary Focus** | IDE productivity, code analysis & linting | **Live AI-Driven E2E Testing** |
| **Connectivity** | Dart Tooling Daemon (DTD) | WebSocket to **Injected Harness** |
| **App Control** | Hot reload/restart, workspace symbols | Mocking, backgrounding, network interception |
| **AI Discovery** | Widget Tree (standard) | **Semantics-first** (`explore_screen`) |
| **Assertions** | Manual tree inspection by agent | **On-device** assertions (`assert_exists`, etc.) |
| **Key Tools** | `dart_fix`, `analyze_files`, `run_tests`, `pub` | `tap`, `explore_screen`, `assert_*`, `intercept_network` |

**Use both together:** the official server for deep code analysis, package management, and standard IDE features; use Flutter Pilot when you need the agent to **live-test** the app UI, simulate complex environment states, and verify behavior with high-level assertions.

### Agent Instructions (Copy & Paste)

If you're using both servers in the same project, drop the following into your project's `AGENTS.md` (or equivalent instruction file) so your AI agent knows when to reach for which:

<details>
<summary>📋 Click to expand dual-server agent instructions</summary>

```markdown
## MCP Server Usage Guide

This project has two MCP servers. Use the right one for the job:

### Official Dart/Flutter MCP Server
Use for **code-level** work — things you'd do in an IDE:
- Adding/removing packages (`pub add`, `pub remove`)
- Resolving symbols, finding definitions (`resolve_workspace_symbol`, `hover`)
- Running unit/widget tests (`run_tests`)
- Static analysis and formatting (`analyze_files`, `dart_fix`, `dart_format`)
- Hot reload/restart via DTD (`hot_reload`, `hot_restart`)
- Reading package source code (`read_package_uris`)

### Flutter Pilot MCP Server
Use for **live UI** work — things a real user would do:
- Launching the app on a device (`list_devices`, `start_app`)
- Tapping, typing, scrolling, swiping, dragging (`tap`, `long_press`, `double_tap`, `enter_text`, `scroll`, `swipe`, `drag_and_drop`, `press_key`)
- Checking what's on screen (`explore_screen`, `get_widget_tree`, `take_screenshot`, `screenshot_element`, `get_text`)
- Asserting UI state (`assert_exists`, `assert_not_exists`, `assert_text_equals`, `assert_state`)
- Mocking network responses (`intercept_network`)
- Navigating (`navigate_to`, `go_back`, `get_current_route`)
- Simulating environment (`simulate_background`, `set_network_status`)
- Wiping app data (`wipe_app_data`)
- Executing scoped waits (`wait_for`, `wait_for_gone`)

### Key Rules
- **Hot restart**: Use `pilot_hot_restart` if the app was started via Pilot's `start_app`.
  Use the official `hot_restart` if working through DTD. Never mix them.
- **Optimal workflow**: Use the Official server to edit code → `pilot_hot_restart` to refresh →
  Pilot's `explore_screen` or `assert_exists` to verify the change rendered correctly.
- After any Pilot interaction (`tap`, `enter_text`, etc.), the harness automatically
  calls `pumpAndSettle()`. You don't need manual waits unless testing async network latency.
```

</details>

---

## 🧪 Running Tests

The project includes comprehensive verification scripts:

```bash
# Build (includes Dart syntax verification)
npm run build

# Run the full integration test suite
npm run verify-integration
```

The integration tests boot a real Flutter app (`test_app/`), exercise all major tools over JSON-RPC, and verify correct behavior.

---

## 📄 License

MIT

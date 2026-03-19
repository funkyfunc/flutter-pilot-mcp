# 🧪 Flutter Test Pilot

An [MCP server](https://modelcontextprotocol.io) that lets AI agents **see, tap, type, scroll, and assert** inside live Flutter apps — no pre-written tests required.

Flutter Test Pilot bridges your LLM (Claude, Gemini, etc.) to a running Flutter application via `integration_test` + WebSocket, giving the agent full interactive control of the UI.

---

## ✨ What Can It Do?

| Category | Tools |
|---|---|
| **Lifecycle** | `start_app` · `stop_app` · `pilot_hot_restart` |
| **Interaction** | `tap` · `enter_text` · `scroll` · `scroll_until_visible` · `wait_for` |
| **Inspection** | `get_widget_tree` · `get_accessibility_tree` · `explore_screen` · `take_screenshot` |
| **Assertions** | `assert_exists` · `assert_not_exists` · `assert_text_equals` · `assert_state` |
| **Navigation** | `navigate_to` |
| **Environment** | `simulate_background` · `set_network_status` · `intercept_network` |
| **Utilities** | `validate_project` · `read_logs` |

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

### Interaction

| Tool | Description |
|---|---|
| `tap` | Taps a widget. Automatically scrolls it into view first. |
| `enter_text` | Enters text into a `TextField`. Optionally sends a `TextInputAction` (e.g. `done`, `search`). |
| `scroll` | Drags a widget by `(dx, dy)`. |
| `scroll_until_visible` | Scrolls a scrollable container until a target widget appears. |
| `wait_for` | Polls until a widget appears (with timeout). |

### Inspection

| Tool | Description |
|---|---|
| `get_widget_tree` | Returns the full widget tree as JSON. Use `summaryOnly: true` to filter layout noise. |
| `get_accessibility_tree` | Returns the Semantics tree — compact, labels-focused, ideal for LLMs. |
| `explore_screen` | Maps all interactive elements on the current screen using the native Semantics tree. |
| `take_screenshot` | Captures a PNG screenshot. `type: "app"` (recommended) renders via Flutter; `"device"` uses native capture. |

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
| `simulate_background` | Sends the app to background and brings it back after a duration. |
| `set_network_status` | Toggles WiFi on/off (macOS/iOS Simulator only). |
| `intercept_network` | Registers a mock HTTP response for a URL pattern. Pass null to clear. |

### Utilities

| Tool | Description |
|---|---|
| `validate_project` | Checks for required dependencies and platform entitlements. Use `auto_fix: true` to resolve automatically. |
| `read_logs` | Returns the last N lines from the app's stdout/stderr. |

---

## 🤝 Using with the Official Dart/Flutter MCP Server

Flutter Test Pilot is **complementary** to the [official Dart/Flutter MCP server](https://github.com/dart-lang/ai). They serve different purposes:

| | Official Dart MCP | Flutter Test Pilot |
|---|---|---|
| **Focus** | IDE tooling & code analysis | Interactive UI driving & testing |
| **Key tools** | `dart_fix`, `analyze_files`, `run_tests`, `pub` | `tap`, `explore_screen`, `assert_*`, `take_screenshot` |
| **Connection** | Dart Tooling Daemon (DTD) | WebSocket to injected harness |

**Use both together:** the official server for code analysis and package management, and Flutter Test Pilot for end-to-end UI verification.

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

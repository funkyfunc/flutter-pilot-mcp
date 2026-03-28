# 🧪 Flutter Driver MCP

An [MCP server](https://modelcontextprotocol.io) that lets AI agents **see, tap, type, scroll, and assert** inside live Flutter apps — no pre-written tests required.

Flutter Driver MCP bridges your LLM (Claude, Gemini, etc.) to a running Flutter application via Flutter's test framework + WebSocket, giving the agent full interactive control of the UI.

---

## 💡 Why Flutter Driver MCP?

**Zero-config injection.** No changes to your app's source code. The harness is auto-injected at launch time — just point at a project path and go.

**Focused, LLM-optimized toolset.** 26 purpose-built tools instead of hundreds. Every tool description fits comfortably in an LLM context window without drowning the model in irrelevant options.

**Suggestive errors.** When a widget isn't found, the harness fuzzy-matches against the live widget tree and returns **"Did you mean…?"** suggestions — dramatically reducing agent retry loops and wasted tokens.

**Token-efficient inspection.** Widget tree output strips Dart generics, flattens layout boilerplate (Container, Padding, SizedBox…), and omits heavyweight coordinate data by default. The agent sees only what matters.

**Full WidgetTester power.** Every interaction runs through Flutter's real test framework with `pumpAndSettle()` after each action — no timing hacks, no flaky coordinate-based taps.

## ✨ What Can It Do?

| Category | Tools |
|---|---|
| **Lifecycle** | `start_app` · `stop_app` · `pilot_hot_restart` · `list_devices` |
| **Interaction** | `tap` · `enter_text` · `scroll` · `drag_and_drop` · `scroll_until_visible` · `wait_for` · `press_key` |
| **Inspection** | `get_widget_tree` · `get_accessibility_tree` · `explore_screen` · `get_text` · `screenshot` |
| **Assertions** | `assert` |
| **Navigation** | `navigate_to` · `go_back` · `get_current_route` |
| **Environment** | `simulate_background` · `set_network_status` · `intercept_network` |
| **Utilities** | `read_logs` · `batch_actions` · `wait_for_animation` |

### Unified Selectors

All interaction tools accept a simple `target` string instead of verbose JSON:

```
"#my_key"                    →  find by Key
"text=\"Submit\""              →  find by text
"type=\"Checkbox\""            →  find by widget type
"tooltip=\"Back\""             →  find by tooltip
"semanticsLabel=\"Username\""  →  find by semantics label (hint text, accessibility label)
```

### Suggestive Errors

When a widget isn't found, the harness scans the tree and returns **"Did you mean…?"** suggestions — dramatically reducing agent retry loops.

---

## 🏗 Architecture

```
┌──────────────┐    JSON-RPC/stdio    ┌──────────────────┐   WebSocket   ┌──────────────────┐
│  MCP Client  │ ◄──────────────────► │  Node.js Server  │ ──connects──► │  Dart Harness    │
│  (LLM Agent) │                      │  (index.ts)      │               │  (harness.dart)  │
└──────────────┘                      └──────────────────┘               │  inside Flutter  │
                                                                         │  flutter_test    │
                                                                         └──────────────────┘
```

1. The **Node.js MCP server** receives tool calls from any MCP-compatible client.
2. On `start_app`, it injects a Dart harness into the project's `integration_test/` directory and launches `flutter run --machine`.
3. The harness starts a WebSocket server inside the app. The Node server connects to it and sends JSON-RPC commands.
4. All interactions (tap, scroll, assert, screenshot, etc.) execute inside the real Flutter test framework with full access to the widget tree.

> **Zero external dependencies.** The harness only imports `dart:*` core libraries and `package:flutter_test` (already in every Flutter project). No changes to your `pubspec.yaml`, no entitlement edits, no setup steps.

---

## 📦 Installation

You can run the server directly via `npx` in your MCP configuration without installing anything globally.

If you instead wish to install it globally:
```bash
npm install -g flutter-driver-mcp
```

### Prerequisites

- **Node.js** ≥ 18
- **Flutter SDK** on your `PATH`
- Any Flutter project — no additional dependencies or setup required

---

## 🚀 Usage

### Add to your MCP client config

Use `npx -y flutter-driver-mcp` to run the server.

Add the following to your MCP client configuration:
```json
{
  "mcpServers": {
    "flutter-driver-mcp": {
      "command": "npx",
      "args": ["-y", "flutter-driver-mcp"]
    }
  }
}
```

### Quick start

Once your MCP client is connected, just tell the agent what you want — it'll figure out the tools:

> *"Launch my app at `/path/to/my_app` on macOS and test the login flow"*

> *"Verify the account creation flow is working"*

> *"Take a screenshot and verify the home screen loaded"*

The agent handles `start_app`, `explore_screen`, `tap`, `assert`, `screenshot`, etc. automatically. No need to spell out tool calls.

---

## 🔧 Tool Reference

### Lifecycle

| Tool | Description |
|---|---|
| `start_app` | Injects the harness, launches the app via `flutter run`, and connects over WebSocket. Surfaces actual build errors (compiler messages, Xcode failures) instead of generic timeouts. |
| `stop_app` | Gracefully sends `app.stop` to the Flutter daemon, kills processes, and cleans up. |
| `pilot_hot_restart` | Sends a full restart command to the running app (preserves session). |
| `list_devices` | Lists available Flutter devices (simulators, emulators, physical, desktop). No running app required. |

### Interaction

| Tool | Description |
|---|---|
| `tap` | Taps, long-presses, or double-taps a widget. Set `gesture: "long_press"` or `gesture: "double"` to change behavior. Defaults to a normal tap. Automatically scrolls it into view first. |
| `enter_text` | Enters text into a `TextField`. Supports finding fields by hint text via `semanticsLabel="Hint"`. Set `clearFirst: true` to explicitly clear the field before typing. Optionally sends a `TextInputAction` (e.g. `done`, `search`). |
| `scroll` | Scrolls or swipes a widget. Use `dx`/`dy` for pixel-precise scrolling, or `direction` (`up`/`down`/`left`/`right`) + optional `distance` for named swipe gestures. |
| `drag_and_drop` | Drags from a source widget to a destination widget or custom pixel offset. |
| `scroll_until_visible` | Scrolls a scrollable container until a target widget appears. |
| `wait_for` | Polls until a widget appears (with timeout). Set `gone: true` to wait for disappearance instead (e.g. loading spinners). |
| `press_key` | Simulates a keyboard key press (enter, tab, escape, backspace, arrow keys, etc.). |

### Inspection

| Tool | Description |
|---|---|
| `get_widget_tree` | Returns the full widget tree as JSON. Use `summaryOnly: true` to filter layout noise. |
| `get_accessibility_tree` | Returns the Semantics tree — compact, labels-focused, ideal for LLMs. Pass `includeRect: true` if coordinates are needed. |
| `explore_screen` | Maps all interactive elements on the current screen using the native Semantics tree. Each element includes a `suggestedTarget` — a copy-pasteable selector string guaranteed to work with interaction tools. |
| `get_text` | Returns the raw text string from a widget (supports `Text`, `EditableText`, and `RichText` descendants). |
| `screenshot` | Captures a PNG screenshot. Without a `target`, captures the full app (defaults to `type: "app"`). With a `target`, captures that specific widget. |

### Assertions

| Tool | Description |
|---|---|
| `assert` | Runs an assertion on a widget. Use `check` to specify the type: `exists`, `not_exists`, `text_equals` (with `expected`), `text_contains` (substring match with `expected`), `count` (with `expected` integer), `state` (with `stateKey` + `expected`), `visible`, or `enabled` (with `expected`). |

### Navigation & Environment

| Tool | Description |
|---|---|
| `navigate_to` | Pushes a named route via `Navigator.pushNamed`. **Does NOT work with GoRouter or other custom routers** — use `tap()` to navigate via on-screen elements instead. |
| `go_back` | Pops the current route or dismisses modal overlays (bottom sheets, dialogs). Falls back to Escape key for overlays that aren't Navigator routes. |
| `get_current_route` | Returns the name of the currently active route — lets the agent know where it is. |
| `simulate_background` | Sends the app to background and brings it back after a duration. |
| `set_network_status` | Toggles WiFi on/off (macOS/iOS Simulator only). |
| `intercept_network` | Registers a mock HTTP response for a URL pattern. Pass null to clear. |

### Utilities

| Tool | Description |
|---|---|
| `read_logs` | Returns the last N lines from the app's stdout/stderr. |
| `batch_actions` | Executes multiple actions in a single tool call (e.g. fill a form: 5× `enter_text` + `tap`). Runs sequentially with `pumpAndSettle` between each. |
| `wait_for_animation` | Waits for all animations to finish before proceeding. |

---

## 🤝 Using with the Official Dart/Flutter MCP Server

Flutter Driver MCP is **complementary** to the [official Dart/Flutter MCP server](https://github.com/dart-lang/ai). While there is some overlap in app interaction (like widget tree inspection), they serve distinct roles in a developer's workflow:

| Feature | Official Dart MCP | Flutter Driver MCP |
|---|---|---|
| **Primary Focus** | IDE productivity, code analysis & linting | **Live AI-Driven E2E Testing** |
| **Connectivity** | Dart Tooling Daemon (DTD) | WebSocket to **Injected Harness** |
| **App Control** | Hot reload/restart, workspace symbols | Mocking, backgrounding, network interception |
| **AI Discovery** | Widget Tree (standard) | **Semantics-first** (`explore_screen`) |
| **Assertions** | Manual tree inspection by agent | **On-device** assertions (`assert` with `check` parameter) |
| **Key Tools** | `dart_fix`, `analyze_files`, `run_tests`, `pub` | `tap`, `explore_screen`, `assert`, `intercept_network` |

**Use both together:** the official server for deep code analysis, package management, and standard IDE features; use Flutter Driver MCP when you need the agent to **live-test** the app UI, simulate complex environment states, and verify behavior with high-level assertions.

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

### Flutter Driver MCP Server
Use for **live UI** work — things a real user would do:
- Launching the app on a device (`list_devices`, `start_app`)
- Tapping, typing, scrolling, swiping, dragging (`tap` with `gesture`, `enter_text`, `scroll` with `direction`, `drag_and_drop`, `press_key`)
- Checking what's on screen (`explore_screen`, `get_widget_tree`, `screenshot`, `get_text`)
- Asserting UI state (`assert` with `check`: `exists`, `not_exists`, `text_equals`, `text_contains`, `count`, `state`, `visible`, `enabled`)
- Mocking network responses (`intercept_network`)
- Navigating (`navigate_to`, `go_back`, `get_current_route`)
- Simulating environment (`simulate_background`, `set_network_status`)
- Executing scoped waits (`wait_for` with `gone` flag)

### Key Rules
- **Hot restart**: Use `pilot_hot_restart` if the app was started via Driver's `start_app`.
  Use the official `hot_restart` if working through DTD. Never mix them.
- **Optimal workflow**: Use the Official server to edit code → `pilot_hot_restart` to refresh →
  Driver's `explore_screen` or `assert_exists` to verify the change rendered correctly.
- After any Driver interaction (`tap`, `enter_text`, etc.), the harness automatically
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

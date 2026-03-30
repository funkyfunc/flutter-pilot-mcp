# AGENTS.md

Welcome! If you are an AI agent (or a human new to the codebase) looking to contribute to `flutter-driver-mcp`, this guide provides the necessary architectural context, conventions, and workflows you need to be effective.

## 🧭 Design Philosophy

These six principles define the soul of the project. Every feature, error message, and API choice should reinforce them. If a change conflicts with any of these, rethink the approach.

### 1. Agent-First, Not Human-First

This is **not** a testing framework that happens to have an MCP wrapper. It is purpose-built for LLM agents. Every design decision should be evaluated through the lens of: *"Does this make the agent more effective?"* — not "Does this look nice in a terminal?" Human developers benefit as a side effect, but the agent is always the primary user.

### 2. Zero-Friction Entry

A user should go from "I have a Flutter project" to "an agent is controlling it" in one tool call. No `pubspec.yaml` edits, no entitlement files, no configuration steps, no `validate_project` pre-flight. The harness imports only `dart:*` and `package:flutter_test` — both already in every Flutter project. If you're about to add an external dependency to the harness, **stop and find another way.**

### 3. Errors That Coach

A blind error like `"Widget not found"` costs the agent a retry loop — burning tokens, time, and user patience. Every error in this project should answer three questions: **What went wrong? Why? What should the agent try instead?** Examples of this in practice:
- `"Target is not scrollable and is not inside a scrollable container. Use tap() instead."`
- `"App uses a custom router like GoRouter. Please use the tap() tool to navigate on-screen elements instead."`
- `"Too many elements found. Consider using a more specific finder, or pass an 'index' parameter."`
- `"Did you mean key: [<submit_btn>]?"` (fuzzy match on failed finder)

When adding new handlers, **always throw errors that suggest the next action.** Never throw raw exceptions without context.

### 4. Token Economy

LLM context windows are expensive. Every byte we send back matters. Design outputs to be information-dense and noise-free:
- Strip Dart generics (`Provider<User>` → `Provider`) because they're noise to an agent.
- Omit coordinate data by default — agents work with semantics, not pixels.
- Return semantic diffs on `tap` (what labels appeared/disappeared) so the agent can verify state changes without a follow-up screenshot.
- Provide `suggestedTarget` in `explore_screen` so the agent can copy-paste a selector instead of constructing one from raw tree data.

When designing a new tool's response, ask: *"What's the minimum the agent needs to decide what to do next?"*

### 5. Semantic Over Positional

We don't tap at coordinates. We tap widgets by key, text, tooltip, or semantics label. This makes agent interactions resilient to layout changes, screen sizes, and platform differences. If you're ever tempted to add a "tap at x,y" feature, consider whether there's a semantic alternative first.

### 6. Fewer Tools, Smarter Parameters

Instead of `tap`, `long_press`, `double_tap` as three separate tools, we have one `tap` tool with a `gesture` parameter. Instead of `assert_exists`, `assert_not_exists`, `assert_text_equals` as separate tools, we have one `assert` tool with a `check` parameter. This keeps the tool list short enough to fit in an LLM's system prompt without overwhelming it. When adding a new capability, **first ask if it can be a parameter on an existing tool.** Only create a new tool when the capability is genuinely distinct.

## 🏗️ Architecture Deep Dive

> [!CAUTION]
> **NEVER** commit or push any files within the `./invisible/` directory to the remote repository. This folder is reserved for local-only scratchpads, personal notes, and internal context that should not be shared publicly.

The system is fundamentally composed of two halves communicating over a local WebSocket:

1. **The Node.js MCP Server (`src/index.ts`)**
   - Implements the Model Context Protocol.
   - Parses tools and arguments from the MCP Client (like Claude or Gemini).
   - Manages the lifecycle of the Flutter application (spawning processes, capturing logs).
   - Forwards most commands as JSON-RPC payloads over a WebSocket to the Dart harness.

2. **The Dart Harness (`src/harness.dart` & `src/harness.ts`)**
   - A zero-config test script injected into the target Flutter application. Requires no external pub dependencies — only `dart:*` core libraries and `package:flutter_test` (already in every Flutter project).
   - Starts a WebSocket server inside the app that the Node server connects to. Translates JSON-RPC commands into Flutter `WidgetTester` operations (`tap`, `scroll`, `find.byKey`, `assert`, etc.).

### The Injection Mechanism (`start_app`)
When the `start_app` tool is invoked, the following magic happens to seamlessly control the app:
- The Node server picks a random free port.
- It dynamically reads `harness.dart`, injects the target app's `main.dart` import, and writes it to `integration_test/mcp_harness.dart` in the target project.
- It runs `flutter run --machine --target integration_test/mcp_harness.dart --dart-define WS_PORT=<port>`.
- The Dart harness starts a WebSocket server on that port. The Node server connects to it (with retries) and communication begins.
- On hot restart, the harness rebinds the WS server and Node auto-reconnects.

## 🛠️ How to Add a New Tool

To add a new capability (e.g., `long_press`), follow this strict checklist:

1. **Define the Tool (`src/tools.ts`)**: Add a `server.registerTool("long_press", { description, inputSchema }, handler)` call inside `registerTools()`. Describe its `inputSchema` thoroughly.
   - *Note on Selectors*: If your tool accepts a `target` string (the Unified Selector format), use `resolveTargetArgs(args)` to parse it before sending: 
     ```typescript
     const payload = resolveTargetArgs(args);
     ```
   - Use `await sendRpc("long_press", payload)` to ask the Dart harness to do the work.
2. **Handle the JSON-RPC Command (`src/harness.dart`)**: In the `main` method's `ws` stream listener, add a `case 'long_press':` block to the `switch (method)`. Route it to a new handler like `_handleLongPress(tester, params)`.
3. **Implement the WidgetTester Logic (`src/harness.dart`)**: Create the `Future<void> _handleLongPress(...)` method. 
   - First, resolve the target: `final result = _resolveWidgetFinder(params);`
   - Use `tester` to perform the action: `await tester.longPress(result.finder);`
   - Wait for the UI to settle: `await tester.pumpAndSettle();`

## 🧠 Codebase Conventions

### 1. Optimize for Cognitive Load (Intent-Based Naming)
Rename variables, functions, and classes to explicitly describe their business intent and real-world behavior, not their data types. Eliminate vague names like `data`, `temp`, `helper`, or `processStuff`. When reading the code, you should know exactly what problem it solves without reading the implementation.

### 2. Flatten the Logic (Aggressive Early Returns)
Refactor control flow to minimize cyclomatic complexity. Eliminate deep nesting (the "arrow anti-pattern") by using early returns and guard clauses at the top of functions. The "happy path" of the function should always be at the outermost level.

### Unified Selectors
Instead of forcing the LLM to write verbose JSON like `{ "finderType": "byKey", "key": "myButton" }`, most tools accept a single `target` string.
- `target: "#myButton"` → `find.byKey(Key('myButton'))`
- `target: "text=\"Submit\""` → `find.text('Submit')`
- `target: "type=\"ElevatedButton\""` → `find.byWidgetPredicate((widget) => widget.runtimeType.toString() == 'ElevatedButton')`
- `target: "tooltip=\"Back\""` → `find.byTooltip('Back')`

This string is parsed by `parseTarget()` in `src/index.ts` *before* the JSON-RPC request is sent to Dart. By the time it reaches `src/harness.dart`, it is a flat map with `finderType` and the specific property (`key`, `text`, etc.).

### Suggestive Errors
If a `_resolveWidgetFinder()` call fails to find a widget in `src/harness.dart`, it doesn't just throw a blind error. It iterates through all available widgets and performs fuzzy matching to return a "Did you mean..." suggestion (e.g., if you searched for `#submit`, it might suggest `Did you mean key: [<submit_btn>]?`). This is crucial for reducing LLM retry loops (see [Errors That Coach](#3-errors-that-coach)). When writing new logic, ALWAYS use `_resolveWidgetFinder()` or `_resolveLazyWidgetFinder()` rather than calling `find...` directly to inherit this behavior.

### ⚡ Performance & Token Optimization
To minimize LLM latency and context usage, several optimizations are baked into the harness:
- **Type Stripping**: The `get_widget_tree` tool automatically strips Dart generic parameters (e.g., `Provider<User>` becomes `Provider`) using regex.
- **Optional Coordinates**: `get_accessibility_tree` defaults to omitting token-heavy `rect` and `transform` data. Use `includeRect: true` only if relative screen positions are explicitly needed.
- **Network Interception**: The `intercept_network` tool uses a lightweight `HttpClient` proxy (`_McpHttpClient`) in the harness to mock `dart:io` requests without needing external mocking libraries.
- **Robust Screenshots**: The `screenshot` tool defaults to `type: "app"`. This is the most reliable method for AI agents as it captures the Flutter frame directly from memory, bypassing OS-level permission issues that often plague native `"device"` screenshots. On macOS, a native fallback is provided if `"device"` mode is explicitly requested and fails.

## 🧪 Local Testing & Verification

When you make changes to the source code, you must build the TypeScript code, as the node runner uses `dist/src/index.js`. 

- **Build**: Run `npm run build` to compile the TypeScript code and correctly copy `harness.dart` into the `dist/` folder.
- **Validation**: **CRITICAL**: After making any changes, you MUST run `npm run validate` to ensure the code is formatted, type-checked, and builds correctly.
- **Automated Tests**: The repo includes a `test_app` (a simple Flutter app). Run `npm run verify-integration` to boot it up and run assertions on all the MCP tools. If you add a new tool, consider adding a verification step in the `verification/` scripts.

### ⚠️ MCP Tool Calls Use the Installed Server, NOT Your Local Build

> [!IMPORTANT]
> When you call MCP tools like `start_app`, `tap`, or `screenshot` through the MCP client (e.g. Antigravity, Claude, Cursor), those tools execute against the **globally installed or previously-started server process** — NOT your local `dist/` build. Rebuilding with `npm run build` updates the files on disk, but the running MCP server process has already loaded the old code into memory.

This means:
- **`npm run validate` and `npm run build`** verify that your code compiles and passes static checks, but they do NOT test runtime behavior through the MCP server.
- **You cannot test your local changes via MCP tool calls** unless the host application restarts the MCP server process (which reloads from `dist/`).

### Testing with the MCP Inspector (Recommended)

The easiest way to test your local changes end-to-end is with the **MCP Inspector**. It spawns a **fresh** MCP server process from your local `dist/` build, giving you a web UI to call any tool interactively:

```bash
# 1. Build your changes
npm run build

# 2. Launch the inspector (starts the server from dist/index.js)
npx -y @modelcontextprotocol/inspector node dist/index.js
```

This opens a browser at `http://localhost:6274` where you can:
- **Connect** to the locally-built server
- **Browse all tools** and their schemas
- **Call any tool** with custom parameters (e.g., `start_app` with `test_app/`)
- **See the full JSON response** including errors

This is the **preferred method** for testing because:
- It uses your local `dist/` build, not the globally installed version
- It tests the full MCP protocol flow (tool registration → JSON-RPC → harness → response)
- No need to ask the user to restart anything
- You can test Node.js server changes AND Dart harness changes together

Example: to test a `start_app` change, launch the inspector, connect, select `start_app`, enter `project_path: /path/to/flutter-driver-mcp/test_app` and `device_id: macos`, then click **Run Tool**.

### Manual Testing Without the MCP Server

For changes that **only** affect the Dart harness (`src/harness/harness.dart`), you can skip the MCP server entirely and test the harness in isolation:

#### 1. Build and inject the harness manually

```bash
npm run build

# Inject harness into test_app (replaces the INJECT_IMPORT/INJECT_MAIN placeholders)
cat src/harness/harness.dart \
  | sed "s|// INJECT_IMPORT|import 'package:test_app/main.dart' as app;|" \
  | sed "s|// INJECT_MAIN|app.main();|" \
  > test_app/integration_test/mcp_harness.dart
```

#### 2. Run flutter directly on the target device

```bash
# macOS (simplest — no port forwarding needed)
cd test_app && flutter run --target integration_test/mcp_harness.dart \
  --dart-define WS_PORT=9999 -d macos

# iOS Simulator (no port forwarding needed)
cd test_app && flutter run --target integration_test/mcp_harness.dart \
  --dart-define WS_PORT=9999 -d <SIMULATOR_UUID>

# Android Emulator (REQUIRES adb port forwarding — see below)
adb -s emulator-5554 forward tcp:9999 tcp:9999
cd test_app && flutter run --target integration_test/mcp_harness.dart \
  --dart-define WS_PORT=9999 -d emulator-5554
```

#### 3. Verify the harness is running

Look for these lines in the output:
```
I/flutter: MCP: Starting WebSocket server on port 9999
I/flutter: MCP: WebSocket server ready, waiting for Node.js to connect...
```

#### 4. Test WebSocket connectivity from the host

```bash
node -e "
const WebSocket = require('ws');
const ws = new WebSocket('ws://127.0.0.1:9999');
ws.on('open', () => { console.log('Connected!'); ws.close(); process.exit(0); });
ws.on('error', (e) => { console.log('Error:', e.message); process.exit(1); });
setTimeout(() => { console.log('Timeout'); process.exit(1); }, 5000);
"
```

### 🤖 Android-Specific Gotchas

Android emulators have several quirks that don't affect macOS or iOS:

1. **Port Forwarding is Mandatory**: The emulator runs in its own network namespace. `127.0.0.1` inside the emulator is NOT the host's loopback. You must run `adb -s <device> forward tcp:<PORT> tcp:<PORT>` before connecting. The server does this automatically via `src/infra/android.ts`, but manual testing requires you to do it yourself.

2. **Zombie Processes**: When a Flutter integration test crashes or is killed mid-run on Android, the Dart VM process can persist on the emulator even after `adb uninstall`. Subsequent `flutter run` commands may hot-reload into the old zombie process (you'll see the same PID in logcat). **The fix: reboot the emulator** with `adb -s emulator-5554 reboot`, or kill the process with `adb shell am force-stop <package>`.

3. **`debugFrameWasSentToEngine` Assertion**: `LiveTestWidgetsFlutterBinding` with `fullyLive` frame policy triggers a known Flutter assertion in `WidgetsBinding.drawFrame` on Android. This is suppressed by our `FlutterError.onError` filter in `_McpTestBinding`'s constructor. If you see this assertion flooding logcat, it means the filter isn't installed (e.g., the old harness code is still running — see zombie processes above).

4. **Cold Gradle Builds**: First-time Android builds can take 3–5+ minutes due to Gradle dependency resolution. The activity-aware timeout in `flutter-daemon.ts` handles this by resetting the deadline whenever the daemon produces output, but manual testing with `flutter run` can feel very slow. Use `flutter clean` + `flutter pub get` only when you need a truly fresh build.

### The `test_app`

The `test_app/` directory contains a minimal Flutter application used for integration testing. It has:
- A simple multi-screen UI with buttons, text fields, and scrollable lists
- No external dependencies beyond Flutter defaults
- Works on all platforms (macOS, iOS, Android, Chrome)

Use it as the target project for manual testing. The `integration_test/mcp_harness.dart` file is auto-generated and should NOT be committed — it's created fresh by `injectHarnessFile()` (or manually via the `sed` command above).


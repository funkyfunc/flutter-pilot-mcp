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

1. **Define the Tool (`src/index.ts`)**: Look for `server.setRequestHandler(ListToolsRequestSchema, ...)` and add your new tool definition to the `tools` array. Describe its `inputSchema` thoroughly.
2. **Handle the Tool Request (`src/index.ts`)**: Inside `server.setRequestHandler(CallToolRequestSchema, ...)`, add an `if (name === "long_press")` block. 
   - *Note on Selectors*: If your tool accepts a `target` string (the Unified Selector format), remember to parse it before sending: 
     ```typescript
     Object.assign(payload, parseTarget(payload.target));
     delete payload.target;
     ```
   - Use `await sendRpc("long_press", payload)` to ask the Dart harness to do the work.
3. **Handle the JSON-RPC Command (`src/harness.dart`)**: In the `main` method's `ws` stream listener, add a `case 'long_press':` block to the `switch (method)`. Route it to a new handler like `_handleLongPress(tester, params)`.
4. **Implement the WidgetTester Logic (`src/harness.dart`)**: Create the `Future<void> _handleLongPress(...)` method. 
   - First, resolve the target: `final result = _createFinder(params);`
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

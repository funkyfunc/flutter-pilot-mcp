# AGENTS.md

Welcome! If you are an AI agent (or a human new to the codebase) looking to contribute to `flutter-pilot-mcp`, this guide provides the necessary architectural context, conventions, and workflows you need to be effective.

## 🏗️ Architecture Deep Dive

The system is fundamentally composed of two halves communicating over a local WebSocket:

1. **The Node.js MCP Server (`src/index.ts`)**
   - Implements the Model Context Protocol.
   - Parses tools and arguments from the MCP Client (like Claude or Gemini).
   - Manages the lifecycle of the Flutter application (spawning processes, capturing logs).
   - Forwards most commands as JSON-RPC payloads over a WebSocket to the Dart harness.

2. **The Dart Harness (`src/harness.dart` & `src/harness.ts`)**
   - A generic `integration_test` script injected into the target Flutter application.
   - Listens to the WebSocket and translates JSON-RPC commands into Flutter `WidgetTester` operations (`tap`, `scroll`, `find.byKey`, `assert_exists`, etc.).

> [!IMPORTANT]
> To maintain the long-term health of this project, please document any significant new architecture decisions (ADRs) in [./invisible/ADR.md](file:///Users/dino/Development/flutter-pilot-mcp/.invisible/ADR.md).

### The Injection Mechanism (`start_app`)
When the `start_app` tool is invoked, the following magic happens to seamlessly control the app:
- The Node server spawns a WebSocket server on a random free port.
- It dynamically reads `harness.dart`, injects the target app's `main.dart` import, and writes it to `integration_test/mcp_harness.dart` in the target project.
- It runs `flutter run --machine --target integration_test/mcp_harness.dart --dart-define WS_URL=ws://localhost:<port>`.
- It parses the stdout to capture the `appId` and `observatoryUri` to manage the process later.

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
3. **Handle the JSON-RPC Command (`src/harness.dart`)**: In the `main` method's `channel.stream` listener, add a `case 'long_press':` block to the `switch (method)`. Route it to a new handler like `_handleLongPress(tester, params)`.
4. **Implement the WidgetTester Logic (`src/harness.dart`)**: Create the `Future<void> _handleLongPress(...)` method. 
   - First, resolve the target: `final result = _createFinder(params);`
   - Use `tester` to perform the action: `await tester.longPress(result.finder);`
   - Wait for the UI to settle: `await tester.pumpAndSettle();`

## 🧠 Codebase Conventions

### Unified Selectors
Instead of forcing the LLM to write verbose JSON like `{ "finderType": "byKey", "key": "myButton" }`, most tools accept a single `target` string.
- `target: "#myButton"` → `find.byKey(Key('myButton'))`
- `target: "text=\"Submit\""` → `find.text('Submit')`
- `target: "type=\"ElevatedButton\""` → `find.byWidgetPredicate((widget) => widget.runtimeType.toString() == 'ElevatedButton')`
- `target: "tooltip=\"Back\""` → `find.byTooltip('Back')`

This string is parsed by `parseTarget()` in `src/index.ts` *before* the JSON-RPC request is sent to Dart. By the time it reaches `src/harness.dart`, it is a flat map with `finderType` and the specific property (`key`, `text`, etc.).

### Suggestive Errors
If a `_createFinder()` call fails to find a widget in `src/harness.dart`, it doesn't just throw a blind error. It iterates through all available widgets and performs fuzzy matching to return a "Did you mean..." suggestion (e.g., if you searched for `#submit`, it might suggest `Did you mean key: [<submit_btn>]?`). This is crucial for reducing LLM retry loops. When writing new logic, ALWAYS use `_createFinder()` or `_createLazyFinder()` rather than calling `find...` directly to inherit this behavior.

### ⚡ Performance & Token Optimization
To minimize LLM latency and context usage, several optimizations are baked into the harness:
- **Type Stripping**: The `get_widget_tree` tool automatically strips Dart generic parameters (e.g., `Provider<User>` becomes `Provider`) using regex.
- **Optional Coordinates**: `get_accessibility_tree` defaults to omitting token-heavy `rect` and `transform` data. Use `includeRect: true` only if relative screen positions are explicitly needed.
- **Network Interception**: The `intercept_network` tool uses a lightweight `HttpClient` proxy (`_McpHttpClient`) in the harness to mock `dart:io` requests without needing external mocking libraries.
- **Robust Screenshots**: The `take_screenshot` tool defaults to `type: "app"`. This is the most reliable method for AI agents as it captures the Flutter frame directly from memory, bypassing OS-level permission issues that often plague native `"device"` screenshots. On macOS, a native fallback is provided if `"device"` mode is explicitly requested and fails.

## 🧪 Local Testing & Verification

When you make changes to the source code, you must build the TypeScript code, as the node runner uses `dist/src/index.js`. 

- **Build**: Run `npm run build` to compile the TypeScript code and correctly copy `harness.dart` into the `dist/` folder.
- **Automated Tests**: The repo includes a `test_app` (a simple Flutter app). Run `npm run verify-integration` to boot it up and run assertions on all the MCP tools. If you add a new tool, consider adding a verification step in the `verification/` scripts.

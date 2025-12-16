export const getHarnessCode = (packageName?: string) => `
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:web_socket_channel/io.dart';
${packageName ? `import 'package:${packageName}/main.dart' as app;` : ''}

void main() {
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('MCP Pilot Harness', (WidgetTester tester) async {
    ${packageName ? '// Start the app\n    app.main();' : '// No app.main() call injected'}
    
    // Wait for the app to settle initially
    await tester.pumpAndSettle();

    final wsUrl = const String.fromEnvironment('WS_URL', defaultValue: 'ws://localhost:8080');
    print('MCP: Connecting to \$wsUrl');
    
    // Simple retry logic
    IOWebSocketChannel? channel;
    for (var i = 0; i < 5; i++) {
      try {
        channel = IOWebSocketChannel.connect(Uri.parse(wsUrl));
        await channel.ready;
        break;
      } catch (e) {
        print('MCP: Connection failed, retrying in 1s... \$e');
        await Future.delayed(const Duration(seconds: 1));
      }
    }

    if (channel == null) {
      print('MCP: Could not connect to host.');
      return;
    }

    print('MCP: Connected.');
    
    // Notify host we are ready
    channel.sink.add(jsonEncode({
      'jsonrpc': '2.0',
      'method': 'app.started',
      'params': {},
    }));

    await for (final message in channel.stream) {
      print('MCP: Received \$message');
      final map = jsonDecode(message as String) as Map<String, dynamic>;
      final id = map['id'];
      
      // Handle notifications (no id) or requests
      if (id == null) continue;

      final method = map['method'] as String;
      final params = map['params'] as Map<String, dynamic>? ?? {};

      try {
        Object? result;
        switch (method) {
          case 'tap':
            await _handleTap(tester, params);
            break;
          case 'enter_text':
            await _handleEnterText(tester, params);
            break;
          case 'get_widget_tree':
            result = _handleGetWidgetTree();
            break;
          case 'scroll':
            await _handleScroll(tester, params);
            break;
          case 'wait_for':
            await _handleWaitFor(tester, params);
            break;
          default:
            throw 'Unknown method: \$method';
        }
        
        channel.sink.add(jsonEncode({
          'jsonrpc': '2.0',
          'id': id,
          'result': result ?? {'status': 'success'},
        }));
      } catch (e, stack) {
        print('MCP: Error: \$e');
        channel.sink.add(jsonEncode({
          'jsonrpc': '2.0',
          'id': id,
          'error': {
            'code': -32000,
            'message': e.toString(),
            'data': stack.toString(),
          },
        }));
      }
    }
  });
}

Finder _createFinder(Map<String, dynamic> params) {
  final finderType = params['finderType'] as String?;
  if (finderType == null) throw 'finderType is required';

  switch (finderType) {
    case 'byKey':
      return find.byKey(Key(params['key'] as String));
    case 'byValueKey':
      // Check if the key is an int or string
      final keyVal = params['key'];
      if (keyVal is int) {
         return find.byKey(ValueKey<int>(keyVal));
      }
      return find.byKey(ValueKey<String>(keyVal.toString()));
    case 'byText':
      return find.text(params['text'] as String);
    case 'byTooltip':
      return find.byTooltip(params['tooltip'] as String);
    case 'byType':
      // This is tricky as we need the Type object. 
      // Simplified: matches string runtimeType.
      // For exact matches, we might need a more complex mapping or rely on semantics.
      // Fallback to searching by semantic label if type lookup fails or just throw.
      // A safe bet for generic strings is hard in Dart without reflection.
      // We will look for widgets where runtimeType.toString() matches.
      return find.byWidgetPredicate((widget) => widget.runtimeType.toString() == params['type']);
    default:
      throw 'Unsupported finder type: \$finderType';
  }
}

Future<void> _handleTap(WidgetTester tester, Map<String, dynamic> params) async {
  final finder = _createFinder(params);
  await tester.tap(finder);
  await tester.pumpAndSettle();
}

Future<void> _handleEnterText(WidgetTester tester, Map<String, dynamic> params) async {
  final finder = _createFinder(params);
  final text = params['text'] as String;
  await tester.enterText(finder, text);
  await tester.pumpAndSettle();
}

Future<void> _handleScroll(WidgetTester tester, Map<String, dynamic> params) async {
  final finder = _createFinder(params);
  final dx = (params['dx'] as num?)?.toDouble() ?? 0.0;
  final dy = (params['dy'] as num?)?.toDouble() ?? 0.0;
  await tester.drag(finder, Offset(dx, dy));
  await tester.pumpAndSettle();
}

Future<void> _handleWaitFor(WidgetTester tester, Map<String, dynamic> params) async {
  final finder = _createFinder(params);
  final timeout = Duration(milliseconds: params['timeout'] as int? ?? 5000);
  // Custom wait loop since integration_test wait might be different
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.pump(const Duration(milliseconds: 100));
  }
  throw 'Timeout waiting for widget';
}

Map<String, dynamic> _handleGetWidgetTree() {
  // Simple serialization of the semantic tree or widget tree
  // Using debugDumpApp() via string is messy. 
  // Let's traverse the Element tree for a simplified view.
  // Or even better, use the Semantics tree which is cleaner for LLMs.
  
  // For now, let's return a basic summary.
  // Ideally, we'd use a visitor to build a JSON.
  
  // Implementation note: Accessing the element tree directly in a test
  // is possible via WidgetsBinding.instance.rootElement
  
  final root = WidgetsBinding.instance.rootElement;
  if (root == null) return {'error': 'No root element'};
  
  return _serializeElement(root);
}

Map<String, dynamic> _serializeElement(Element element) {
  final children = <Map<String, dynamic>>[];
  element.visitChildren((child) {
    children.add(_serializeElement(child));
  });

  final widget = element.widget;
  final json = <String, dynamic>{
    'type': widget.runtimeType.toString(),
  };

  if (widget is Text) {
    json['data'] = widget.data;
  } else if (widget is Tooltip) {
    json['message'] = widget.message;
  }
  // Add other relevant properties as needed (keys, specific fields)
  if (widget.key != null) {
    json['key'] = widget.key.toString();
  }

  if (children.isNotEmpty) {
    json['children'] = children;
  }
  
  return json;
}
`
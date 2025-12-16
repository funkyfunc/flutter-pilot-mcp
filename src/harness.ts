export const getHarnessCode = (packageName?: string) => `
import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:web_socket_channel/io.dart';
${packageName ? `import 'package:${packageName}/main.dart' as app;` : ''}

class AmbiguousFinderException implements Exception {
  final String message;
  final List<Map<String, dynamic>> matches;

  AmbiguousFinderException(this.message, this.matches);

  @override
  String toString() => 'AmbiguousFinderException: \$message\nMatches: \${jsonEncode(this.matches)}';
}

class _FinderResult {
  final Finder finder;
  final List<Element> elements;

  _FinderResult(this.finder, this.elements);
}

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
            result = _handleGetWidgetTree(params);
            break;
          case 'scroll':
            await _handleScroll(tester, params);
            break;
          case 'scroll_until_visible':
            await _handleScrollUntilVisible(tester, params);
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

_FinderResult _createFinder(Map<String, dynamic> params) {
  final finderType = params['finderType'] as String?;
  if (finderType == null) throw 'finderType is required';

  Finder finder;
  switch (finderType) {
    case 'byKey':
      finder = find.byKey(Key(params['key'] as String));
      break;
    case 'byValueKey':
      final keyVal = params['key'];
      if (keyVal is int) {
         finder = find.byKey(ValueKey<int>(keyVal));
      } else {
        finder = find.byKey(ValueKey<String>(keyVal.toString()));
      }
      break;
    case 'byText':
      finder = find.text(params['text'] as String);
      break;
    case 'byTooltip':
      finder = find.byTooltip(params['tooltip'] as String);
      break;
    case 'byType':
      finder = find.byWidgetPredicate((widget) => widget.runtimeType.toString() == params['type']);
      break;
    default:
      throw 'Unsupported finder type: \$finderType';
  }

  final elements = finder.evaluate().toList();
  if (elements.isEmpty) {
    throw 'WidgetNotFoundException: No widget found with type "\$finderType" and params "\$params"';
  } else if (elements.length > 1) {
    final matches = elements.map((e) => _serializeElement(e, summaryOnly: true)).toList();
    throw AmbiguousFinderException(
      'Too many elements found for finder type "\$finderType" with params "\$params". '
      'Consider using a more specific finder or adding a key.',
      matches,
    );
  }
  return _FinderResult(finder, elements);
}

// Special version of createFinder that DOES NOT throw if empty, 
// useful for scroll_until_visible which expects the widget might be offscreen/lazy loaded?
// Actually scrollUntilVisible needs the widget to be in the tree (even if offscreen).
// If it's lazy loaded (e.g. ListView.builder), it MIGHT NOT BE IN THE TREE yet.
// In that case, flutter_test's scrollUntilVisible iterates until it finds it.
// So we MUST NOT evaluate/throw if empty for scrollUntilVisible target.
Finder _createLazyFinder(Map<String, dynamic> params) {
  final finderType = params['finderType'] as String?;
  if (finderType == null) throw 'finderType is required';

  Finder finder;
  switch (finderType) {
    case 'byKey':
      finder = find.byKey(Key(params['key'] as String));
      break;
    case 'byValueKey':
      final keyVal = params['key'];
      if (keyVal is int) {
         finder = find.byKey(ValueKey<int>(keyVal));
      } else {
        finder = find.byKey(ValueKey<String>(keyVal.toString()));
      }
      break;
    case 'byText':
      finder = find.text(params['text'] as String);
      break;
    case 'byTooltip':
      finder = find.byTooltip(params['tooltip'] as String);
      break;
    case 'byType':
      finder = find.byWidgetPredicate((widget) => widget.runtimeType.toString() == params['type']);
      break;
    default:
      throw 'Unsupported finder type: \$finderType';
  }
  return finder;
}

Future<void> _handleTap(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _createFinder(params);
  await tester.tap(result.finder);
  await tester.pumpAndSettle();
}

Future<void> _handleEnterText(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _createFinder(params);
  final text = params['text'] as String;
  await tester.enterText(result.finder, text);
  await tester.pumpAndSettle();
}

Future<void> _handleScroll(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _createFinder(params);
  final dx = (params['dx'] as num?)?.toDouble() ?? 0.0;
  final dy = (params['dy'] as num?)?.toDouble() ?? 0.0;
  await tester.drag(result.finder, Offset(dx, dy));
  await tester.pumpAndSettle();
}

Future<void> _handleScrollUntilVisible(WidgetTester tester, Map<String, dynamic> params) async {
  // Use _createLazyFinder so we don't throw if it's not currently in the tree (lazy list)
  final targetFinder = _createLazyFinder(params);
  
  // Handle optional scrollable finder
  Finder? scrollableFinder;
  if (params['scrollable'] != null) {
    // For the scrollable itself, it MUST exist.
    final scrollableParams = params['scrollable'] as Map<String, dynamic>;
    final scrollableResult = _createFinder(scrollableParams);
    scrollableFinder = scrollableResult.finder;
  }
  // If null, flutter_test will find the first ancestor scrollable.

  final delta = (params['dy'] as num?)?.toDouble() ?? -50.0; 
      
  try {
    await tester.scrollUntilVisible(
      targetFinder,
      delta.abs(), 
      scrollable: scrollableFinder,
    );
    await tester.pumpAndSettle();
  } catch (e) {
    // If it failed, check if it was due to ambiguity or already visible
    final elements = targetFinder.evaluate().toList();
    if (elements.length > 1) {
       final matches = elements.map((e) => _serializeElement(e, summaryOnly: true)).toList();
       throw AmbiguousFinderException(
         'Scroll failed due to ambiguity. Found \${elements.length} matches.',
         matches,
       );
    } else if (elements.isNotEmpty) {
       // If found (exactly 1) but scroll failed, it implies it might be outside the scrollable
       // OR already visible and the error is confusing.
       // Usually if visible, scrollUntilVisible succeeds.
       // But if it's a FAB outside the scrollable, scrollUntilVisible might fail to find the scrollable context?
       // Let's suggest tapping.
       throw 'Scroll failed, but the widget was found in the tree (and might be already visible or outside the scrollable). Try using "tap" directly. Original error: \$e';
    }
    rethrow;
  }
}

Future<void> _handleWaitFor(WidgetTester tester, Map<String, dynamic> params) async {
  // waitFor implies it might not be there yet.
  final finder = _createLazyFinder(params);
  final timeout = Duration(milliseconds: params['timeout'] as int? ?? 5000);
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.pump(const Duration(milliseconds: 100));
  }
  throw 'Timeout waiting for widget';
}

Map<String, dynamic> _handleGetWidgetTree(Map<String, dynamic> params) {
  final root = WidgetsBinding.instance.rootElement;
  if (root == null) return {'error': 'No root element'};
  
  final summaryOnly = params['summaryOnly'] == true;
  return _serializeElement(root, summaryOnly: summaryOnly);
}

Map<String, dynamic> _serializeElement(Element element, {required bool summaryOnly}) {
  final children = <Map<String, dynamic>>[];
  
  element.visitChildren((child) {
    final serializedChild = _serializeElement(child, summaryOnly: summaryOnly);
    if (!summaryOnly || _shouldKeep(serializedChild)) {
      children.add(serializedChild);
    } else if (serializedChild.containsKey('children')) {
      children.addAll((serializedChild['children'] as List).cast<Map<String, dynamic>>());
    }
  });

  final widget = element.widget;
  final type = widget.runtimeType.toString();
  
  final json = <String, dynamic>{
    'type': type,
  };

  if (widget.key != null) {
    json['key'] = widget.key.toString();
  }
  if (widget is Text) {
    json['data'] = widget.data;
  } else if (widget is Tooltip) {
    json['message'] = widget.message;
  } else if (widget is EditableText) {
    json['value'] = widget.controller?.text;
  } else if (widget is Icon) {
    json['icon'] = widget.icon.toString();
  } else if (widget is Image) {
    json['image'] = widget.image.toString(); 
  } else if (widget is GestureDetector) {
    json['onTap'] = widget.onTap != null;
  } else if (widget is InkWell) {
    json['onTap'] = widget.onTap != null;
  } else if (widget is ElevatedButton) {
    json['onPressed'] = widget.onPressed != null;
  } else if (widget is TextButton) {
    json['onPressed'] = widget.onPressed != null;
  } else if (widget is FloatingActionButton) {
    json['onPressed'] = widget.onPressed != null;
  }
  
  if (children.isNotEmpty) {
    json['children'] = children;
  }
  
  return json;
}

bool _shouldKeep(Map<String, dynamic> json) {
  final type = json['type'] as String;
  final hasKey = json.containsKey('key');
  final hasData = json.containsKey('data'); 
  final hasMessage = json.containsKey('message'); 
  final hasValue = json.containsKey('value'); 
  final hasOnPressed = json.containsKey('onPressed'); 
  
  if (hasKey || hasData || hasMessage || hasValue || hasOnPressed) return true;
  
  const flattenWidgets = {
    'Container', 'Padding', 'Center', 'SizedBox', 'Align', 'Expanded', 'Flexible', 
    'Column', 'Row', 'Stack', 'ConstrainedBox', 'DecoratedBox', 'SafeArea', 
    'SingleChildScrollView', 'Scrollable', 
    'Semantics', 'ExcludeSemantics', 'MergeSemantics',
    'Material', 'Scaffold', 
    '_ViewScope', '_PipelineOwnerScope', '_MediaQueryFromView', 'MediaQuery', 'FocusTraversalGroup', 'Focus', 
    '_FocusInheritedScope', '_FocusScopeWithExternalFocusNode', '_RawViewInternal', 'RawView', 'View', 'RootWidget',
    'GestureDetector', 'InkWell', 
  };
  
  if (flattenWidgets.contains(type)) return false;
  
  return true;
}
`;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:web_socket_channel/io.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:path_provider/path_provider.dart';


// INJECT_IMPORT

// --- Tuning Constants ---
const kPumpSettlingInterval = Duration(milliseconds: 100);
const kDefaultWaitTimeout = Duration(milliseconds: 5000);
const kMaxWebSocketRetries = 5;

// --- Global Network Interceptor ---
class _McpHttpOverrides extends HttpOverrides {
  final Map<String, String> _mocks = {};

  void addMock(String urlPattern, String responseBody) {
    _mocks[urlPattern] = responseBody;
  }

  void clearMocks() {
    _mocks.clear();
  }

  @override
  HttpClient createHttpClient(SecurityContext? context) {
    final client = super.createHttpClient(context);
    return _McpHttpClient(client, this);
  }
}

class _McpHttpClient implements HttpClient {
  final HttpClient _delegate;
  final _McpHttpOverrides _overrides;
  _McpHttpClient(this._delegate, this._overrides);

  @override bool get autoUncompress => _delegate.autoUncompress;
  @override set autoUncompress(bool value) => _delegate.autoUncompress = value;
  @override Duration? get connectionTimeout => _delegate.connectionTimeout;
  @override set connectionTimeout(Duration? value) => _delegate.connectionTimeout = value;
  @override Duration get idleTimeout => _delegate.idleTimeout;
  @override set idleTimeout(Duration value) => _delegate.idleTimeout = value;
  @override int? get maxConnectionsPerHost => _delegate.maxConnectionsPerHost;
  @override set maxConnectionsPerHost(int? value) => _delegate.maxConnectionsPerHost = value;
  @override String? get userAgent => _delegate.userAgent;
  @override set userAgent(String? value) => _delegate.userAgent = value;

  @override void addCredentials(Uri url, String realm, HttpClientCredentials credentials) => _delegate.addCredentials(url, realm, credentials);
  @override void addProxyCredentials(String host, int port, String realm, HttpClientCredentials credentials) => _delegate.addProxyCredentials(host, port, realm, credentials);
  @override set authenticate(Future<bool> Function(Uri url, String scheme, String? realm)? f) => _delegate.authenticate = f;
  @override set authenticateProxy(Future<bool> Function(String host, int port, String scheme, String? realm)? f) => _delegate.authenticateProxy = f;
  @override set badCertificateCallback(bool Function(X509Certificate cert, String host, int port)? callback) => _delegate.badCertificateCallback = callback;
  @override void close({bool force = false}) => _delegate.close(force: force);
  @override set connectionFactory(Future<ConnectionTask<Socket>> Function(Uri url, String? proxyHost, int? proxyPort)? f) => _delegate.connectionFactory = f;
  @override set findProxy(String Function(Uri url)? f) => _delegate.findProxy = f;
  @override set keyLog(Function(String line)? callback) => _delegate.keyLog = callback;

  Future<HttpClientRequest> _handleRequest(String method, Uri url) async {
    final urlString = url.toString();
    for (final pattern in _overrides._mocks.keys) {
      if (urlString.contains(pattern)) {
        return _MockHttpClientRequest(url, method, _overrides._mocks[pattern]!);
      }
    }
    return _delegate.openUrl(method, url);
  }

  @override Future<HttpClientRequest> delete(String host, int port, String path) => _handleRequest('DELETE', Uri(scheme: 'http', host: host, port: port, path: path));
  @override Future<HttpClientRequest> deleteUrl(Uri url) => _handleRequest('DELETE', url);
  @override Future<HttpClientRequest> get(String host, int port, String path) => _handleRequest('GET', Uri(scheme: 'http', host: host, port: port, path: path));
  @override Future<HttpClientRequest> getUrl(Uri url) => _handleRequest('GET', url);
  @override Future<HttpClientRequest> head(String host, int port, String path) => _handleRequest('HEAD', Uri(scheme: 'http', host: host, port: port, path: path));
  @override Future<HttpClientRequest> headUrl(Uri url) => _handleRequest('HEAD', url);
  @override Future<HttpClientRequest> open(String method, String host, int port, String path) => _handleRequest(method, Uri(scheme: 'http', host: host, port: port, path: path));
  @override Future<HttpClientRequest> openUrl(String method, Uri url) => _handleRequest(method, url);
  @override Future<HttpClientRequest> patch(String host, int port, String path) => _handleRequest('PATCH', Uri(scheme: 'http', host: host, port: port, path: path));
  @override Future<HttpClientRequest> patchUrl(Uri url) => _handleRequest('PATCH', url);
  @override Future<HttpClientRequest> post(String host, int port, String path) => _handleRequest('POST', Uri(scheme: 'http', host: host, port: port, path: path));
  @override Future<HttpClientRequest> postUrl(Uri url) => _handleRequest('POST', url);
  @override Future<HttpClientRequest> put(String host, int port, String path) => _handleRequest('PUT', Uri(scheme: 'http', host: host, port: port, path: path));
  @override Future<HttpClientRequest> putUrl(Uri url) => _handleRequest('PUT', url);
}

class _MockHttpClientRequest implements HttpClientRequest {
  @override final Uri uri;
  @override final String method;
  final String _responseBody;
  _MockHttpClientRequest(this.uri, this.method, this._responseBody);

  @override bool bufferOutput = true;
  @override int contentLength = -1;
  @override bool followRedirects = true;
  @override int maxRedirects = kMaxWebSocketRetries;
  @override bool persistentConnection = true;
  @override HttpHeaders get headers => _MockHttpHeaders();
  @override HttpConnectionInfo? get connectionInfo => null;
  @override List<Cookie> get cookies => [];
  @override Encoding encoding = utf8;

  @override Future<HttpClientResponse> get done => Future.value(_MockHttpClientResponse(_responseBody));
  @override Future<HttpClientResponse> close() => Future.value(_MockHttpClientResponse(_responseBody));
  @override void add(List<int> data) {}
  @override void addError(Object error, [StackTrace? stackTrace]) {}
  @override Future addStream(Stream<List<int>> stream) => stream.drain();
  @override Future flush() => Future.value();
  @override void write(Object? obj) {}
  @override void writeAll(Iterable objects, [String separator = ""]) {}
  @override void writeCharCode(int charCode) {}
  @override void writeln([Object? obj = ""]) {}
  @override void abort([Object? exception, StackTrace? stackTrace]) {}
}

class _MockHttpClientResponse extends Stream<List<int>> implements HttpClientResponse {
  final String _body;
  _MockHttpClientResponse(this._body);

  @override int get statusCode => 200;
  @override int get contentLength => utf8.encode(_body).length;
  @override HttpHeaders get headers => _MockHttpHeaders();
  @override StreamSubscription<List<int>> listen(void Function(List<int> event)? onData, {Function? onError, void Function()? onDone, bool? cancelOnError}) {
    return Stream.value(utf8.encode(_body)).listen(onData, onError: onError, onDone: onDone, cancelOnError: cancelOnError);
  }
  @override X509Certificate? get certificate => null;
  @override HttpConnectionInfo? get connectionInfo => null;
  @override List<Cookie> get cookies => [];
  @override Future<Socket> detachSocket() => throw UnsupportedError('detachSocket');
  @override bool get isRedirect => false;
  @override bool get persistentConnection => true;
  @override String get reasonPhrase => 'OK';
  @override List<RedirectInfo> get redirects => [];
  @override HttpClientResponseCompressionState get compressionState => HttpClientResponseCompressionState.notCompressed;
  @override Future<HttpClientResponse> redirect([String? method, Uri? url, bool? followLoops]) => Future.value(this);
}

class _MockHttpHeaders implements HttpHeaders {
  final Map<String, List<String>> _headers = {'content-type': ['application/json; charset=utf-8']};
  @override bool chunkedTransferEncoding = false;
  @override int contentLength = -1;
  @override ContentType? contentType = ContentType.json;
  @override DateTime? date = DateTime.now();
  @override DateTime? expires;
  @override String? host = 'mock';
  @override DateTime? ifModifiedSince;
  @override int? port = 80;
  @override bool persistentConnection = true;
  @override void add(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override void clear() {}
  @override void forEach(void Function(String name, List<String> values) action) => _headers.forEach(action);
  @override void noFolding(String name) {}
  @override void remove(String name, Object value) {}
  @override void removeAll(String name) {}
  @override void set(String name, Object value, {bool preserveHeaderCase = false}) {}
  @override List<String>? operator [](String name) => _headers[name.toLowerCase()];
  @override String? value(String name) => _headers[name.toLowerCase()]?.first;
}

final _mcpHttpOverrides = _McpHttpOverrides();
// ----------------------------------

class AmbiguousFinderException implements Exception {
  final String message;
  final List<Map<String, dynamic>> matches;

  AmbiguousFinderException(this.message, this.matches);

  @override
  String toString() => '''AmbiguousFinderException: $message
Matches: 
''';
}

class _FinderResult {
  final Finder finder;
  final List<Element> elements;

  _FinderResult(this.finder, this.elements);
}

void main() {
  HttpOverrides.global = _mcpHttpOverrides;
  final binding = IntegrationTestWidgetsFlutterBinding.ensureInitialized();
  binding.framePolicy = LiveTestWidgetsFlutterBindingFramePolicy.fullyLive;

  testWidgets('MCP Pilot Harness', (WidgetTester tester) async {
    // INJECT_MAIN
    
    // Wait for the app to settle initially
    await tester.pumpAndSettle();

    final wsUrl = const String.fromEnvironment('WS_URL', defaultValue: 'ws://localhost:8080');
    debugPrint('MCP: Connecting to $wsUrl');
    
    // The Node.js server starts the WebSocket server asynchronously in parallel with launching Flutter.
    // We retry connection 5 times to ensure we do not fail if the Flutter app boots faster than the Node WS server binds to the port.
    IOWebSocketChannel? channel;
    for (var i = 0; i < kMaxWebSocketRetries; i++) {
      try {
        channel = IOWebSocketChannel.connect(Uri.parse(wsUrl));
        await channel.ready;
        break;
      } catch (e) {
        debugPrint('MCP: Connection failed, retrying in 1s... $e');
        await Future.delayed(const Duration(seconds: 1));
      }
    }

    if (channel == null) {
      debugPrint('MCP: Could not connect to host.');
      return;
    }

    debugPrint('MCP: Connected.');
    
    // Notify host we are ready
    channel.sink.add(jsonEncode({
      'jsonrpc': '2.0',
      'method': 'app.started',
      'params': {},
    }));

    await for (final message in channel.stream) {
      debugPrint('MCP: Received $message');
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
          case 'wipe_app_data':
            result = await _handleWipeAppData();
            break;
          case 'drag_and_drop':
             await _handleDragAndDrop(tester, params);
             break;
          case 'get_text':
            result = await _handleGetText(tester, params);
            break;
          case 'get_widget_tree':
            result = _handleGetWidgetTree(tester, params);
            break;
          case 'get_accessibility_tree':
            result = await _handleGetAccessibilityTree(tester, params);
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
          case 'screenshot':
            result = await _handleScreenshot(tester);
            break;
          case 'screenshot_element':
            result = await _handleScreenshotElement(tester, params);
            break;
          case 'assert_exists':
            result = await _handleAssertExists(tester, params);
            break;
          case 'assert_not_exists':
            result = await _handleAssertNotExists(tester, params);
            break;
          case 'assert_text_equals':
            result = await _handleAssertTextEquals(tester, params);
            break;
          case 'assert_state':
            result = await _handleAssertState(tester, params);
            break;
          case 'navigate_to':
            result = await _handleNavigateTo(tester, params);
            break;
          case 'go_back':
            result = await _handleGoBack(tester);
            break;
          case 'get_current_route':
            result = _handleGetCurrentRoute(tester);
            break;
          case 'long_press':
            await _handleLongPress(tester, params);
            break;
          case 'double_tap':
            await _handleDoubleTap(tester, params);
            break;
          case 'swipe':
            await _handleSwipe(tester, params);
            break;
          case 'wait_for_gone':
            await _handleWaitForGone(tester, params);
            break;
          case 'press_key':
            await _handlePressKey(tester, params);
            break;
          case 'intercept_network':
            result = _handleInterceptNetwork(params);
            break;
          case 'explore_screen':
            result = await _handleExploreScreen(tester);
            break;
          default:
            throw 'Unknown method: $method';
        }
        
        channel.sink.add(jsonEncode({
          'jsonrpc': '2.0',
          'id': id,
          'result': result ?? {'status': 'success'},
        }));
      } catch (e, stack) {
        debugPrint('MCP: Error: $e');
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

String _buildSuggestiveErrorMessage(String finderType, Map<String, dynamic> params) {
  final allElements = find.byType(Widget).evaluate().toList();
  final suggestions = <String>[];
  
  if (finderType == 'byText' && params['text'] != null) {
    final target = params['text'].toString().toLowerCase();
    final textWidgets = allElements.where((e) => e.widget is Text).take(100);
    for (final e in textWidgets) {
      final w = e.widget as Text;
      if (w.data != null && w.data!.toLowerCase().contains(target)) {
        suggestions.add('Did you mean text: "${w.data}"?');
      }
    }
  } else if (finderType == 'byKey' && params['key'] != null) {
    final target = params['key'].toString();
    final keyWidgets = allElements.where((e) => e.widget.key != null).take(100);
    for (final e in keyWidgets) {
      final keyStr = e.widget.key.toString();
      if (keyStr.contains(target) || target.contains(keyStr.replaceAll(RegExp(r"[\['<>\]]"), ''))) {
        suggestions.add('Did you mean key: $keyStr (Type: ${e.widget.runtimeType})?');
      }
    }
  }

  final suggestionText = suggestions.isNotEmpty 
    ? '\nSuggestions:\n - ${suggestions.take(3).join('\n - ')}' 
    : '';

  return 'WidgetNotFoundException: No widget found with type "$finderType" and params "$params"$suggestionText';
}

_FinderResult _resolveWidgetFinder(Map<String, dynamic> params) {
  final finderType = params['finderType'] as String?;
  if (finderType == null) throw 'finderType is required';

  final finder = _resolveLazyWidgetFinder(params);
  final elements = finder.evaluate().toList();
  
  if (elements.isEmpty) {
    throw _buildSuggestiveErrorMessage(finderType, params);
  } 
  
  if (elements.length > 1) {
    final index = params['index'] as int?;
    if (index != null && index >= 0 && index < elements.length) {
       return _FinderResult(finder.at(index), [elements[index]]);
    }
    
    final matches = elements.map((e) => _serializeElement(e, summaryOnly: true, screenSize: Size.zero, inOverlay: false)).toList();
    throw AmbiguousFinderException(
      'Too many elements found for finder type "$finderType" with params "$params". '
      'Consider using a more specific finder, adding a key, or explicitly passing an "index" parameter (e.g. index: 0) to select the exact match out of ${elements.length}.',
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
Finder _resolveLazyWidgetFinder(Map<String, dynamic> params) {
  final finderType = params['finderType'] as String?;
  if (finderType == null) throw 'finderType is required';

  Finder finder;
  switch (finderType.toLowerCase()) {
    case 'bykey':
      finder = find.byKey(Key(params['key'] as String));
      break;
    case 'byvaluekey':
      final keyVal = params['key'];
      if (keyVal is int) {
         finder = find.byKey(ValueKey<int>(keyVal));
      } else {
        finder = find.byKey(ValueKey<String>(keyVal.toString()));
      }
      break;
    case 'bytext':
      finder = find.text(params['text'] as String);
      break;
    case 'bytooltip':
      finder = find.byTooltip(params['tooltip'] as String);
      break;
    case 'bytype':
      finder = find.byWidgetPredicate((widget) => widget.runtimeType.toString() == params['type']);
      break;
    case 'byid':
      final idString = params['id'].toString();
      final id = int.tryParse(idString);
      finder = find.byElementPredicate((Element element) {
         return element.renderObject?.debugSemantics?.id == id;
      });
      break;
    default:
      throw 'Unsupported finder type: $finderType';
  }
  return finder;
}

Future<void> _handleTap(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _resolveWidgetFinder(params);
  try {
    await tester.ensureVisible(result.finder);
    await tester.pumpAndSettle();
  } catch (e) {
    // Ignore ensureVisible errors (e.g. widget not in a scrollable), proceed to tap
  }
  await tester.tap(result.finder, warnIfMissed: false);
  await tester.pumpAndSettle();
}

Future<void> _handleEnterText(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _resolveWidgetFinder(params);
  final text = params['text'] as String;
  await tester.enterText(result.finder, text);
  await tester.pumpAndSettle();

  if (params.containsKey('action')) {
    final actionStr = params['action'] as String;
    TextInputAction action;
    switch (actionStr) {
      case 'done': action = TextInputAction.done; break;
      case 'search': action = TextInputAction.search; break;
      case 'next': action = TextInputAction.next; break;
      case 'go': action = TextInputAction.go; break;
      case 'send': action = TextInputAction.send; break;
      case 'previous': action = TextInputAction.previous; break;
      case 'continueAction': action = TextInputAction.continueAction; break;
      case 'join': action = TextInputAction.join; break;
      case 'route': action = TextInputAction.route; break;
      case 'emergencyCall': action = TextInputAction.emergencyCall; break;
      case 'newline': action = TextInputAction.newline; break;
      case 'none': action = TextInputAction.none; break;
      default: action = TextInputAction.done;
    }
    await tester.testTextInput.receiveAction(action);
    await tester.pumpAndSettle();
  }
}

Future<Map<String, dynamic>> _handleGetText(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _resolveWidgetFinder(params);
  final element = result.elements.first;
  final widget = element.widget;
  
  String? actualText;
  if (widget is Text) {
    actualText = widget.data;
  } else if (widget is EditableText) {
    actualText = widget.controller.text;
  } else if (widget is RichText) {
    actualText = widget.text.toPlainText();
  } else {
    final textFinder = find.descendant(of: result.finder, matching: find.byType(Text));
    if (textFinder.evaluate().isNotEmpty) {
       actualText = (textFinder.evaluate().first.widget as Text).data;
    } else {
       throw 'Widget is not a Text widget and has no Text descendant.';
    }
  }

  return {'text': actualText ?? ''};
}

Future<Map<String, dynamic>> _handleWipeAppData() async {
  int deletedCount = 0;
  final clearedDirs = <String>[];

  Future<void> clearDir(Directory dir) async {
    if (await dir.exists()) {
      clearedDirs.add(dir.path);
      final entities = dir.listSync();
      for (final entity in entities) {
        try {
          if (entity is File) {
             await entity.delete();
             deletedCount++;
          } else if (entity is Directory) {
             await entity.delete(recursive: true);
             deletedCount++;
          }
        } catch (_) {}
      }
    }
  }

  try { await clearDir(await getApplicationDocumentsDirectory()); } catch (_) {}
  try { await clearDir(await getApplicationSupportDirectory());   } catch (_) {}
  try { await clearDir(await getTemporaryDirectory());            } catch (_) {}

  return {
    'success': true,
    'deleted_files': deletedCount,
    'directories_cleared': clearedDirs,
  };
}

Future<void> _handleDragAndDrop(WidgetTester tester, Map<String, dynamic> params) async {
  final fromParams = params['from'] as Map<String, dynamic>?;
  if (fromParams == null) throw 'from target is required';
  
  final fromResult = _resolveWidgetFinder(fromParams);
  final centerFrom = tester.getCenter(fromResult.finder);
  
  Offset offset;
  if (params['to'] != null) {
      final toParams = params['to'] as Map<String, dynamic>;
      final toResult = _resolveWidgetFinder(toParams);
      final centerTo = tester.getCenter(toResult.finder);
      offset = centerTo - centerFrom;
  } else {
      final dx = (params['dx'] as num?)?.toDouble() ?? 0.0;
      final dy = (params['dy'] as num?)?.toDouble() ?? 0.0;
      offset = Offset(dx, dy);
  }
  
  final durationMs = params['duration_ms'] as int?;
  if (durationMs != null && durationMs > 0) {
      await tester.timedDrag(fromResult.finder, offset, Duration(milliseconds: durationMs));
  } else {
      await tester.drag(fromResult.finder, offset);
  }
  
  await tester.pumpAndSettle();
}

Future<void> _handleScroll(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _resolveWidgetFinder(params);
  final dx = (params['dx'] as num?)?.toDouble() ?? 0.0;
  final dy = (params['dy'] as num?)?.toDouble() ?? 0.0;
  await tester.drag(result.finder, Offset(dx, dy));
  await tester.pumpAndSettle();
}

Future<void> _handleScrollUntilVisible(WidgetTester tester, Map<String, dynamic> params) async {
  // Use _resolveLazyWidgetFinder so we don't throw if it's not currently in the tree (lazy list)
  final targetFinder = _resolveLazyWidgetFinder(params);
  
  // Handle optional scrollable finder
  Finder? scrollableFinder;
  if (params['scrollable'] != null) {
    // For the scrollable itself, it MUST exist.
    final scrollableParams = params['scrollable'] as Map<String, dynamic>;
    final scrollableResult = _resolveWidgetFinder(scrollableParams);
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
       final matches = elements.map((e) => _serializeElement(e, summaryOnly: true, screenSize: Size.zero, inOverlay: false)).toList();
       throw AmbiguousFinderException(
         'Scroll failed due to ambiguity. Found ${elements.length} matches.',
         matches,
       );
    } else if (elements.isNotEmpty) {
       // If found (exactly 1) but scroll failed, it implies it might be outside the scrollable
       // OR already visible and the error is confusing.
       // Usually if visible, scrollUntilVisible succeeds.
       // But if it's a FAB outside the scrollable, scrollUntilVisible might fail to find the scrollable context?
       // Let's suggest tapping.
       throw 'Scroll failed, but the widget was found in the tree (and might be already visible or outside the scrollable). Try using "tap" directly. Original error: $e';
    }
    rethrow;
  }
}

Future<void> _handleWaitFor(WidgetTester tester, Map<String, dynamic> params) async {
  // waitFor implies it might not be there yet.
  final finder = _resolveLazyWidgetFinder(params);
  final timeout = Duration(milliseconds: params['timeout'] as int? ?? kDefaultWaitTimeout.inMilliseconds);
  final end = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(end)) {
    if (finder.evaluate().isNotEmpty) return;
    await tester.pump(kPumpSettlingInterval);
  }
  throw 'Timeout waiting for widget';
}

Future<Map<String, dynamic>> _handleAssertExists(WidgetTester tester, Map<String, dynamic> params) async {
  try {
    _resolveWidgetFinder(params);
    return {'success': true};
  } catch (e) {
    return {'success': false, 'error': e.toString()};
  }
}

Future<Map<String, dynamic>> _handleAssertNotExists(WidgetTester tester, Map<String, dynamic> params) async {
  final finder = _resolveLazyWidgetFinder(params);
  final exists = finder.evaluate().isNotEmpty;
  if (exists) {
    return {'success': false, 'error': 'Widget exists but was expected not to.'};
  }
  return {'success': true};
}

Future<Map<String, dynamic>> _handleAssertTextEquals(WidgetTester tester, Map<String, dynamic> params) async {
  final expectedText = params['expectedText'] as String?;
  if (expectedText == null) throw 'expectedText is required';
  
  final result = _resolveWidgetFinder(params);
  final element = result.elements.first;
  final widget = element.widget;
  
  String? actualText;
  if (widget is Text) {
    actualText = widget.data;
  } else if (widget is EditableText) {
    actualText = widget.controller.text;
  } else if (widget is RichText) {
    actualText = widget.text.toPlainText();
  } else {
    // Try to find a text child
    final textFinder = find.descendant(of: result.finder, matching: find.byType(Text));
    if (textFinder.evaluate().isNotEmpty) {
       actualText = (textFinder.evaluate().first.widget as Text).data;
    } else {
       throw 'Widget is not a Text widget and has no Text descendant.';
    }
  }

  if (actualText == expectedText) {
    return {'success': true};
  } else {
    return {
      'success': false, 
      'error': 'Text mismatch. Expected: "$expectedText", Actual: "$actualText"'
    };
  }
}

Future<Map<String, dynamic>> _handleAssertState(WidgetTester tester, Map<String, dynamic> params) async {
  final stateKey = params['stateKey'] as String?;
  final expectedValue = params['expectedValue'];
  if (stateKey == null || expectedValue == null) throw 'stateKey and expectedValue are required';

  final result = _resolveWidgetFinder(params);
  final widget = result.elements.first.widget;
  
  Object? actualValue;
  if (widget is Checkbox) {
    if (stateKey == 'value') actualValue = widget.value;
  } else if (widget is Switch) {
    if (stateKey == 'value') actualValue = widget.value;
  } else if (widget is Radio) {
    // ignore: deprecated_member_use
    if (stateKey == 'groupValue') actualValue = widget.groupValue;
    if (stateKey == 'value') actualValue = widget.value;
  } else if (widget is Slider) {
    if (stateKey == 'value') actualValue = widget.value;
  } else {
    throw 'Unsupported stateKey "$stateKey" for widget type ${widget.runtimeType}';
  }

  if (actualValue == expectedValue) {
    return {'success': true};
  } else {
    return {
      'success': false, 
      'error': 'State mismatch. Expected "$stateKey": $expectedValue, Actual: $actualValue'
    };
  }
}

Future<Map<String, dynamic>> _handleNavigateTo(WidgetTester tester, Map<String, dynamic> params) async {
  final route = params['route'] as String?;
  if (route == null) throw 'route is required';

  try {
    // Need to find a BuildContext. Use the root element.
    final rootElement = tester.binding.rootElement;
    if (rootElement == null) throw 'No root element found';

    // To navigate, we need a Navigator. Find the first NavigatorState.
    final navigatorFinder = find.byType(Navigator);
    if (navigatorFinder.evaluate().isEmpty) {
      throw 'No Navigator found in the widget tree.';
    }

    final context = navigatorFinder.evaluate().first;
    Navigator.pushNamed(context, route);
    await tester.pumpAndSettle();
    
    return {'success': true};
  } catch (e) {
    return {'success': false, 'error': e.toString()};
  }
}

Map<String, dynamic> _handleInterceptNetwork(Map<String, dynamic> params) {
  final urlPattern = params['urlPattern'] as String?;
  final responseBody = params['responseBody'] as String?;
  
  if (urlPattern == null || responseBody == null) {
      // If null, we'll clear it out for now as a way to reset
      _mcpHttpOverrides.clearMocks();
      return {'success': true, 'message': 'Mocks cleared'};
  }
  
  _mcpHttpOverrides.addMock(urlPattern, responseBody);
  return {'success': true};
}

Future<Map<String, dynamic>> _handleExploreScreen(WidgetTester tester) async {
  // Ensure semantics are enabled
  final semanticsHandle = tester.binding.ensureSemantics();
  
  // Wait for the semantics tree to be generated
  SemanticsNode? root;
  for (int i = 0; i < kMaxWebSocketRetries; i++) {
    await tester.pump(kPumpSettlingInterval);
    // ignore: deprecated_member_use
    root = tester.binding.pipelineOwner.semanticsOwner?.rootSemanticsNode;
    if (root != null) break;
  }
  
  if (root == null) {
    semanticsHandle.dispose();
    return {'error': 'No root semantics node after 5 pumps'};
  }
  
  final interactiveNodes = <Map<String, dynamic>>[];
  _collectInteractiveSemantics(root, interactiveNodes);
  
  semanticsHandle.dispose();

  return {
    'interactive_elements_count': interactiveNodes.length,
    'elements': interactiveNodes,
  };
}

void _collectInteractiveSemantics(SemanticsNode node, List<Map<String, dynamic>> collection) {
  final data = node.getSemanticsData();
  final flagsCollection = data.flagsCollection;
  
  final isInteractive = flagsCollection.isButton || 
                        flagsCollection.isTextField ||
                        flagsCollection.isLink ||
                        data.hasAction(SemanticsAction.tap) ||
                        data.hasAction(SemanticsAction.longPress) ||
                        data.hasAction(SemanticsAction.setText) ||
                        flagsCollection.isChecked != ui.CheckedState.none ||
                        flagsCollection.isSlider;
  
  if (isInteractive && !flagsCollection.isHidden) {
      final json = <String, dynamic>{
        'id': node.id,
      };
      if (data.label.isNotEmpty) json['label'] = data.label;
      if (data.value.isNotEmpty) json['value'] = data.value;
      if (data.tooltip.isNotEmpty) json['tooltip'] = data.tooltip;
      if (data.hint.isNotEmpty) json['hint'] = data.hint;
      
      final flags = <String>[];
      if (flagsCollection.isButton) flags.add('isButton');
      if (flagsCollection.isTextField) flags.add('isTextField');
      if (flagsCollection.isChecked != ui.CheckedState.none) flags.add('hasCheckedState');
      if (flagsCollection.isChecked == ui.CheckedState.isTrue) flags.add('isChecked');
      if (flagsCollection.isSelected == ui.Tristate.isTrue) flags.add('isSelected');
      if (flagsCollection.isSlider) flags.add('isSlider');
      if (flags.isNotEmpty) json['flags'] = flags;

      final actions = <String>[];
      if (data.hasAction(SemanticsAction.tap)) actions.add('tap');
      if (data.hasAction(SemanticsAction.longPress)) actions.add('longPress');
      if (data.hasAction(SemanticsAction.setText)) actions.add('setText');
      if (actions.isNotEmpty) json['actions'] = actions;

      collection.add(json);
  }
  
  if (node.hasChildren) {
    node.visitChildren((child) {
      _collectInteractiveSemantics(child, collection);
      return true; 
    });
  }
}

Future<Map<String, dynamic>> _handleGetAccessibilityTree(WidgetTester tester, Map<String, dynamic> params) async {
  // Ensure semantics are enabled
  final semanticsHandle = tester.binding.ensureSemantics();
  
  // Wait for the semantics tree to be generated
  SemanticsNode? root;
  for (int i = 0; i < kMaxWebSocketRetries; i++) {
    await tester.pump(kPumpSettlingInterval);
    // ignore: deprecated_member_use
    root = tester.binding.pipelineOwner.semanticsOwner?.rootSemanticsNode;
    if (root != null) break;
  }
  
  if (root == null) {
    semanticsHandle.dispose(); // Dispose on error
    return {'error': 'No root semantics node after 5 pumps'};
  }
  
  final includeRect = params['includeRect'] == true;
  final result = _serializeSemanticsNode(root, includeRect: includeRect);
  semanticsHandle.dispose(); // Dispose after use
  return result;
}

Map<String, dynamic> _serializeSemanticsNode(SemanticsNode node, {required bool includeRect}) {
  // print('MCP: Serializing node ${node.id}');
  final json = <String, dynamic>{
    'id': node.id,
  };

  if (includeRect) {
    json['rect'] = {
      'left': node.rect.left,
      'top': node.rect.top,
      'width': node.rect.width,
      'height': node.rect.height,
    };
    if (node.transform != null) {
      json['transform'] = node.transform!.toString();
    }
  }

  final data = node.getSemanticsData();
  
  if (data.label.isNotEmpty) json['label'] = data.label;
  if (data.value.isNotEmpty) json['value'] = data.value;
  if (data.increasedValue.isNotEmpty) json['increasedValue'] = data.increasedValue;
  if (data.decreasedValue.isNotEmpty) json['decreasedValue'] = data.decreasedValue;
  if (data.hint.isNotEmpty) json['hint'] = data.hint;
  if (data.tooltip.isNotEmpty) json['tooltip'] = data.tooltip;
  if (data.textDirection != null) json['textDirection'] = data.textDirection.toString();

  // Flags
  final flags = <String>[];
  final flagsCollection = data.flagsCollection;
  if (flagsCollection.isChecked != ui.CheckedState.none) flags.add('hasCheckedState');
  if (flagsCollection.isChecked == ui.CheckedState.isTrue) flags.add('isChecked');
  if (flagsCollection.isSelected == ui.Tristate.isTrue) flags.add('isSelected');
  if (flagsCollection.isButton) flags.add('isButton');
  if (flagsCollection.isTextField) flags.add('isTextField');
  if (flagsCollection.isReadOnly) flags.add('isReadOnly');
  if (flagsCollection.isLink) flags.add('isLink');
  if (flagsCollection.isHeader) flags.add('isHeader');
  if (flagsCollection.isSlider) flags.add('isSlider');
  if (flagsCollection.isLiveRegion) flags.add('isLiveRegion');
  if (flagsCollection.isHidden) flags.add('isHidden');
  if (flagsCollection.isImage) flags.add('isImage');
  if (flagsCollection.isInMutuallyExclusiveGroup) flags.add('isInMutuallyExclusiveGroup');
  if (flagsCollection.scopesRoute) flags.add('scopesRoute');
  if (flagsCollection.namesRoute) flags.add('namesRoute');
  if (flagsCollection.isObscured) flags.add('isObscured');
  if (flagsCollection.isMultiline) flags.add('isMultiline');
  if (flagsCollection.isFocused != ui.Tristate.none) flags.add('isFocusable');
  if (flagsCollection.isFocused == ui.Tristate.isTrue) flags.add('isFocused');
  if (flagsCollection.isEnabled == ui.Tristate.isTrue) flags.add('isEnabled');
  
  if (flags.isNotEmpty) json['flags'] = flags;

  // Actions
  final actions = <String>[];
  
  if (data.hasAction(SemanticsAction.tap)) actions.add('tap');
  if (data.hasAction(SemanticsAction.longPress)) actions.add('longPress');
  if (data.hasAction(SemanticsAction.scrollLeft)) actions.add('scrollLeft');
  if (data.hasAction(SemanticsAction.scrollRight)) actions.add('scrollRight');
  if (data.hasAction(SemanticsAction.scrollUp)) actions.add('scrollUp');
  if (data.hasAction(SemanticsAction.scrollDown)) actions.add('scrollDown');
  if (data.hasAction(SemanticsAction.increase)) actions.add('increase');
  if (data.hasAction(SemanticsAction.decrease)) actions.add('decrease');
  if (data.hasAction(SemanticsAction.showOnScreen)) actions.add('showOnScreen');
  if (data.hasAction(SemanticsAction.moveCursorForwardByCharacter)) actions.add('moveCursorForwardByCharacter');
  if (data.hasAction(SemanticsAction.moveCursorBackwardByCharacter)) actions.add('moveCursorBackwardByCharacter');
  if (data.hasAction(SemanticsAction.setSelection)) actions.add('setSelection');
  if (data.hasAction(SemanticsAction.copy)) actions.add('copy');
  if (data.hasAction(SemanticsAction.cut)) actions.add('cut');
  if (data.hasAction(SemanticsAction.paste)) actions.add('paste');
  if (data.hasAction(SemanticsAction.didGainAccessibilityFocus)) actions.add('didGainAccessibilityFocus');
  if (data.hasAction(SemanticsAction.didLoseAccessibilityFocus)) actions.add('didLoseAccessibilityFocus');
  if (data.hasAction(SemanticsAction.customAction)) actions.add('customAction');
  if (data.hasAction(SemanticsAction.dismiss)) actions.add('dismiss');
  if (data.hasAction(SemanticsAction.moveCursorForwardByWord)) actions.add('moveCursorForwardByWord');
  if (data.hasAction(SemanticsAction.moveCursorBackwardByWord)) actions.add('moveCursorBackwardByWord');
  if (data.hasAction(SemanticsAction.setText)) actions.add('setText');

  if (actions.isNotEmpty) json['actions'] = actions;

  // Recursion
  if (node.hasChildren) {
    final children = <Map<String, dynamic>>[];
    node.visitChildren((child) {
      children.add(_serializeSemanticsNode(child, includeRect: includeRect));
      return true; 
    });
    json['children'] = children;
  }

  return json;
}

Map<String, dynamic> _handleGetWidgetTree(WidgetTester tester, Map<String, dynamic> params) {
  final root = tester.binding.rootElement;
  if (root == null) return {'error': 'No root element'};
  
  final summaryOnly = params['summaryOnly'] == true;
  final view = tester.view;
  final screenSize = view.physicalSize / view.devicePixelRatio;
  return _serializeElement(root, summaryOnly: summaryOnly, screenSize: screenSize, inOverlay: false);
}

void _extractWidgetProperties(Widget widget, Map<String, dynamic> json) {
  if (widget.key != null) { json['key'] = widget.key.toString(); }

  if (widget is Text) { json['data'] = widget.data; }
  else if (widget is Tooltip) { json['message'] = widget.message; }
  else if (widget is EditableText) { json['value'] = widget.controller.text; }
  else if (widget is Icon) { json['icon'] = widget.icon.toString(); }
  else if (widget is Image) { json['image'] = widget.image.toString(); } 
  else if (widget is GestureDetector) { json['onTap'] = widget.onTap != null; }
  else if (widget is InkWell) { json['onTap'] = widget.onTap != null; }
  else if (widget is ElevatedButton) { json['onPressed'] = widget.onPressed != null; }
  else if (widget is TextButton) { json['onPressed'] = widget.onPressed != null; }
  else if (widget is FloatingActionButton) { json['onPressed'] = widget.onPressed != null; }
}

void _detectViewportVisibility(RenderObject renderObject, Size screenSize, Map<String, dynamic> json) {
  if (!renderObject.attached) return;
  try {
    final transform = renderObject.getTransformTo(null);
    final paintBounds = MatrixUtils.transformRect(transform, renderObject.paintBounds);
    final screenRect = Offset.zero & screenSize;
    if (paintBounds.width > 0 && paintBounds.height > 0) {
      json['isInViewport'] = screenRect.overlaps(paintBounds);
    }
  } catch (_) {
    // Ignore transform errors
  }
}

Map<String, dynamic> _serializeElement(Element element, {required bool summaryOnly, required Size screenSize, required bool inOverlay}) {
  final widget = element.widget;
  final type = widget.runtimeType.toString().replaceAll(RegExp(r'<[^>]*>'), '');
  
  final isOverlayType = type == 'Overlay' || type == '_OverlayEntryWidget' || type == 'Dialog' || type == 'BottomSheet' || type == 'PopupMenuButton';
  final currentlyInOverlay = inOverlay || isOverlayType;

  final children = <Map<String, dynamic>>[];
  
  element.visitChildren((child) {
    final serializedChild = _serializeElement(child, summaryOnly: summaryOnly, screenSize: screenSize, inOverlay: currentlyInOverlay);
    if (!summaryOnly || _shouldKeep(serializedChild)) {
      children.add(serializedChild);
    } else if (serializedChild.containsKey('children')) {
      children.addAll((serializedChild['children'] as List).cast<Map<String, dynamic>>());
    }
  });

  final json = <String, dynamic>{'type': type};
  if (currentlyInOverlay) json['isOverlay'] = true;

  if (element.renderObject != null) {
    _detectViewportVisibility(element.renderObject!, screenSize, json);
  }

  _extractWidgetProperties(widget, json);

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

Future<Map<String, dynamic>> _handleScreenshot(WidgetTester tester) async {
  try {
    final element = tester.binding.rootElement;
    if (element == null) return {'error': 'No root element'};
    
    final image = await captureImage(element);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    if (byteData == null) return {'error': 'Failed to encode image'};
    
    final bytes = byteData.buffer.asUint8List();
    final base64String = base64Encode(bytes);
    
    return {
      'data': base64String,
      'format': 'png',
    };
  } catch (e) {
    return {'error': e.toString()};
  }
}

// ─── Long Press ──────────────────────────────────────────────────────────────

Future<void> _handleLongPress(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _resolveWidgetFinder(params);
  try {
    await tester.ensureVisible(result.finder);
    await tester.pumpAndSettle();
  } catch (_) {
    // Ignore visibility errors, proceed to long-press
  }
  await tester.longPress(result.finder, warnIfMissed: false);
  await tester.pumpAndSettle();
}

// ─── Double Tap ──────────────────────────────────────────────────────────────

Future<void> _handleDoubleTap(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _resolveWidgetFinder(params);
  try {
    await tester.ensureVisible(result.finder);
    await tester.pumpAndSettle();
  } catch (_) {
    // Ignore visibility errors, proceed to tap
  }
  await tester.tap(result.finder, warnIfMissed: false);
  await tester.pump(const Duration(milliseconds: 100));
  await tester.tap(result.finder, warnIfMissed: false);
  await tester.pumpAndSettle();
}

// ─── Swipe (Directional) ─────────────────────────────────────────────────────

Future<void> _handleSwipe(WidgetTester tester, Map<String, dynamic> params) async {
  final result = _resolveWidgetFinder(params);
  final direction = params['direction'] as String? ?? 'up';
  final distance = (params['distance'] as num?)?.toDouble() ?? 300.0;

  final Offset offset;
  switch (direction.toLowerCase()) {
    case 'up':    offset = Offset(0, -distance); break;
    case 'down':  offset = Offset(0, distance);  break;
    case 'left':  offset = Offset(-distance, 0); break;
    case 'right': offset = Offset(distance, 0);  break;
    default: throw 'Invalid swipe direction: "$direction". Use up, down, left, or right.';
  }

  await tester.drag(result.finder, offset);
  await tester.pumpAndSettle();
}

// ─── Wait For Gone ───────────────────────────────────────────────────────────

Future<void> _handleWaitForGone(WidgetTester tester, Map<String, dynamic> params) async {
  final finder = _resolveLazyWidgetFinder(params);
  final timeout = Duration(milliseconds: params['timeout'] as int? ?? kDefaultWaitTimeout.inMilliseconds);
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (finder.evaluate().isEmpty) return;
    await tester.pump(kPumpSettlingInterval);
  }
  throw 'Timeout waiting for widget to disappear';
}

// ─── Go Back ─────────────────────────────────────────────────────────────────

Future<Map<String, dynamic>> _handleGoBack(WidgetTester tester) async {
  final navigatorFinder = find.byType(Navigator);
  if (navigatorFinder.evaluate().isEmpty) {
    return {'success': false, 'error': 'No Navigator found in the widget tree.'};
  }

  final navigatorElement = navigatorFinder.evaluate().first;
  final navigatorState = (navigatorElement as StatefulElement).state as NavigatorState;

  if (!navigatorState.canPop()) {
    return {'success': false, 'error': 'Cannot pop — already at root route.'};
  }

  navigatorState.pop();
  await tester.pumpAndSettle();
  return {'success': true};
}

// ─── Get Current Route ───────────────────────────────────────────────────────

Map<String, dynamic> _handleGetCurrentRoute(WidgetTester tester) {
  String? currentRouteName;

  final navigatorFinder = find.byType(Navigator);
  if (navigatorFinder.evaluate().isEmpty) {
    return {'error': 'No Navigator found in the widget tree.'};
  }

  final navigatorElement = navigatorFinder.evaluate().first;
  final navigatorState = (navigatorElement as StatefulElement).state as NavigatorState;

  navigatorState.popUntil((route) {
    currentRouteName = route.settings.name;
    return true; // Don't actually pop, just read
  });

  return {'route': currentRouteName};
}

// ─── Press Key ───────────────────────────────────────────────────────────────

Future<void> _handlePressKey(WidgetTester tester, Map<String, dynamic> params) async {
  final keyName = params['key'] as String?;
  if (keyName == null || keyName.isEmpty) throw 'key parameter is required';

  const keyMap = <String, LogicalKeyboardKey>{
    'enter': LogicalKeyboardKey.enter,
    'tab': LogicalKeyboardKey.tab,
    'escape': LogicalKeyboardKey.escape,
    'backspace': LogicalKeyboardKey.backspace,
    'delete': LogicalKeyboardKey.delete,
    'space': LogicalKeyboardKey.space,
    'arrowUp': LogicalKeyboardKey.arrowUp,
    'arrowDown': LogicalKeyboardKey.arrowDown,
    'arrowLeft': LogicalKeyboardKey.arrowLeft,
    'arrowRight': LogicalKeyboardKey.arrowRight,
    'home': LogicalKeyboardKey.home,
    'end': LogicalKeyboardKey.end,
    'pageUp': LogicalKeyboardKey.pageUp,
    'pageDown': LogicalKeyboardKey.pageDown,
  };

  final logicalKey = keyMap[keyName];
  if (logicalKey == null) {
    final knownKeys = keyMap.keys.join(', ');
    throw 'Unknown key: "$keyName". Supported keys: $knownKeys';
  }

  await tester.sendKeyEvent(logicalKey);
  await tester.pumpAndSettle();
}

// ─── Screenshot Element ──────────────────────────────────────────────────────

Future<Map<String, dynamic>> _handleScreenshotElement(WidgetTester tester, Map<String, dynamic> params) async {
  try {
    final result = _resolveWidgetFinder(params);
    final element = result.elements.first;
    final renderObject = element.renderObject;

    if (renderObject == null || renderObject is! RenderBox) {
      return {'error': 'Widget has no RenderBox — cannot capture screenshot.'};
    }

    // Find the nearest RepaintBoundary ancestor for clean capture
    RenderRepaintBoundary? boundary;
    RenderObject? current = renderObject;
    while (current != null) {
      if (current is RenderRepaintBoundary) {
        boundary = current;
        break;
      }
      current = current.parent;
    }

    if (boundary == null) {
      // Fallback: capture the full app and crop
      return _handleScreenshot(tester);
    }

    final image = await boundary.toImage(pixelRatio: tester.view.devicePixelRatio);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    if (byteData == null) return {'error': 'Failed to encode element image'};

    return {
      'data': base64Encode(byteData.buffer.asUint8List()),
      'format': 'png',
    };
  } catch (e) {
    return {'error': e.toString()};
  }
}

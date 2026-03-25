import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  runApp(const MyApp());
}

class MyApp extends StatelessWidget {
  const MyApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Test App',
      initialRoute: '/',
      routes: {
        '/': (context) => const HomeScreen(),
        '/details': (context) => const DetailsScreen(),
        '/reorder': (context) => const ReorderScreen(),
      },
    );
  }
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  bool _isChecked = false;
  final TextEditingController _controller = TextEditingController();
  String _networkResult = '';
  String _longPressStatus = '';
  int _doubleTapCount = 0;
  bool _showDismissable = true;
  int _counter = 0;

  @override
  void initState() {
    super.initState();
    _loadCounter();
  }

  Future<void> _loadCounter() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _counter = prefs.getInt('counter') ?? 0;
    });
  }

  Future<void> _saveCounter() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setInt('counter', _counter + 1);
    await _loadCounter();
  }

  Future<void> _fetchData() async {
    try {
      final client = HttpClient();
      final request = await client.getUrl(Uri.parse('https://example.com/api/data'));
      final response = await request.close();
      final stringData = await response.transform(utf8.decoder).join();
      setState(() => _networkResult = stringData);
    } catch (e) {
      setState(() => _networkResult = 'Error: $e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Home Screen')),
      body: SingleChildScrollView(
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Text('Welcome Home', key: Key('welcome_text')),
              Checkbox(
                key: const Key('my_checkbox'),
                value: _isChecked,
                onChanged: (val) => setState(() => _isChecked = val ?? false),
              ),
              Padding(
                padding: const EdgeInsets.all(16.0),
                child: TextField(
                  key: const Key('my_textfield'),
                  controller: _controller,
                  decoration: const InputDecoration(hintText: 'Enter text here'),
                ),
              ),
              ElevatedButton(
                key: const Key('nav_button'),
                onPressed: () => Navigator.pushNamed(context, '/details'),
                child: const Text('Go to Details'),
              ),
              ElevatedButton(
                key: const Key('fetch_button'),
                onPressed: _fetchData,
                child: const Text('Fetch Data'),
              ),
              Text(_networkResult, key: const Key('network_result')),
              const SizedBox(height: 8),
              ElevatedButton(
                key: const Key('save_pref_button'),
                onPressed: _saveCounter,
                child: const Text('Save Prefs'),
              ),
              Text('Counter: $_counter', key: const Key('pref_counter')),
              const SizedBox(height: 8),
              GestureDetector(
                key: const Key('long_press_target'),
                onLongPress: () => setState(() => _longPressStatus = 'Long pressed!'),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  color: Colors.blue.shade100,
                  child: const Text('Long press me'),
                ),
              ),
              Text(_longPressStatus, key: const Key('long_press_status')),
              const SizedBox(height: 8),
              GestureDetector(
                key: const Key('double_tap_target'),
                onDoubleTap: () => setState(() => _doubleTapCount++),
                child: Container(
                  padding: const EdgeInsets.all(12),
                  color: Colors.green.shade100,
                  child: const Text('Double tap me'),
                ),
              ),
              Text('$_doubleTapCount', key: const Key('double_tap_count')),
              const SizedBox(height: 8),
              ElevatedButton(
                key: const Key('toggle_visibility'),
                onPressed: () => setState(() => _showDismissable = !_showDismissable),
                child: const Text('Toggle Widget'),
              ),
              if (_showDismissable)
                const Text('I can disappear', key: Key('dismissable_widget')),
            ],
          ),
        ),
      ),
    );
  }
}

class DetailsScreen extends StatelessWidget {
  const DetailsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Details')),
      body: ListView.builder(
        itemCount: 100,
        itemBuilder: (context, index) {
          return ListTile(
            title: Text('Item $index'),
            key: ValueKey('item_$index'),
            onTap: () {
              // Just a dummy action to make it interactive semantics
            },
          );
        },
      ),
    );
  }
}

class ReorderScreen extends StatefulWidget {
  const ReorderScreen({super.key});

  @override
  State<ReorderScreen> createState() => _ReorderScreenState();
}

class _ReorderScreenState extends State<ReorderScreen> {
  final List<String> _items = ['Item A', 'Item B', 'Item C'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Reorder')),
      body: ReorderableListView(
        onReorder: (oldIndex, newIndex) {
          setState(() {
            if (newIndex > oldIndex) {
              newIndex -= 1;
            }
            final item = _items.removeAt(oldIndex);
            _items.insert(newIndex, item);
          });
        },
        children: [
          for (int i = 0; i < _items.length; i++)
            ListTile(
              key: ValueKey(_items[i]),
              title: Text(_items[i]),
              subtitle: Text('Index $i', key: Key('index_${_items[i]}')),
            ),
        ],
      ),
    );
  }
}


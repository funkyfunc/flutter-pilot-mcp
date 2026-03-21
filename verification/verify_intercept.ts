import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execa } from 'execa';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from "fs/promises";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    console.log('[Verify] Starting Network Intercept Verification...');
    
    // Start the server process
    const serverProcess = execa('node', [path.resolve(__dirname, '../src/index.js')]);
    
    // Connect client
    const transport = new StdioClientTransport({
        command: 'node',
        args: [path.resolve(__dirname, '../src/index.js')]
    });
    
    const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
    await client.connect(transport);
    
    const testAppPath = path.resolve(__dirname, '../../test_app');

    try {
        console.log('[Verify] Starting App...');
        await client.callTool({
            name: "start_app",
            arguments: { project_path: testAppPath, device_id: 'macos' }
        });

        // 1. Mock the network
        console.log('[Verify] Intercepting network request to example.com...');
        await client.callTool({
            name: "intercept_network",
            arguments: { urlPattern: "example.com", responseBody: "Mocked Response Body" }
        });

        // 2. Tap the fetch button
        console.log('[Verify] Tapping fetch button...');
        await client.callTool({
            name: "tap",
            arguments: { target: "#fetch_button" }
        });

        // wait briefly for ui to settle (pumpAndSettle handles most of it, but state updates might need a beat)
        await new Promise(r => setTimeout(r, 1000));

        // 3. Assert the result matches the mock
        console.log('[Verify] Asserting network result matches mock...');
        const result = await client.callTool({
            name: "assert_text_equals",
            arguments: { target: "#network_result", expectedText: "Mocked Response Body" }
        });

        if (result.isError) {
             throw new Error("Assertion failed: " + JSON.stringify(result));
        }
        
        console.log('✅ [Verify] SUCCESS: Intercept network feature worked as expected!');

    } catch (e: any) {
        console.error('❌ [Verify] FAILED:', e);
        process.exit(1);
    } finally {
        console.log('[Verify] Cleaning up...');
        try {
            await client.callTool({ name: "stop_app", arguments: {} });
        } catch (e) {}
        process.exit(0);
    }
}

main();

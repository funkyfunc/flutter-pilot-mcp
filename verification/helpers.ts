/**
 * Shared MCP test client boilerplate.
 *
 * Spawns the MCP server as a child process and provides a typed `send()`
 * function for JSON-RPC communication. Used by all verification scripts
 * that need a running server (i.e., everything except verify_harness_syntax).
 */

import { type ChildProcess, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface McpResponse {
	id?: number;
	result?: {
		content?: Array<{ type: string; text: string }>;
		isError?: boolean;
		tools?: McpTool[];
	};
	error?: { message: string };
}

export interface McpTool {
	name: string;
	inputSchema: { properties: Record<string, unknown> };
}

// ─── Server Lifecycle ───────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_JS = path.join(__dirname, "../dist/index.js");
export const TEST_APP_PATH = path.join(__dirname, "../test_app");

export function spawnServer(
	stderr: "inherit" | "pipe" | typeof process.stderr = "inherit",
): ChildProcess {
	return spawn("node", [SERVER_JS], {
		stdio: ["pipe", "pipe", stderr],
	});
}

// ─── JSON-RPC Client ────────────────────────────────────────────────────────

export interface McpClient {
	/** Send a JSON-RPC request and wait for the matching response. */
	send: (
		method: string,
		params?: Record<string, unknown>,
	) => Promise<McpResponse>;
	/** The underlying server process. */
	server: ChildProcess;
	/** Kill the server and clean up. */
	cleanup: () => void;
}

/**
 * Creates a promise-based MCP client around a spawned server process.
 * Resolves responses by matching JSON-RPC IDs.
 */
export function createClient(
	stderr: "inherit" | "pipe" | typeof process.stderr = "inherit",
): McpClient {
	const server = spawnServer(stderr);
	let msgId = 1;
	const pending = new Map<number, (res: McpResponse) => void>();

	let buffer = "";

	server.stdout?.on("data", (data: Buffer) => {
		buffer += data.toString();
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (!line.trim() || line.startsWith("MCP:")) continue;
			try {
				const msg = JSON.parse(line) as McpResponse;
				if (msg.id !== undefined && pending.has(msg.id)) {
					const cb = pending.get(msg.id);
					pending.delete(msg.id);
					cb?.(msg);
				}
			} catch {
				// Non-JSON output (build logs, etc.)
			}
		}
	});

	function send(
		method: string,
		params: Record<string, unknown> = {},
	): Promise<McpResponse> {
		const id = msgId++;
		const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params });
		server.stdin?.write(`${payload}\n`);

		return new Promise<McpResponse>((resolve) => {
			pending.set(id, resolve);
		});
	}

	function cleanup(): void {
		try {
			server.kill("SIGKILL");
		} catch {
			/* already dead */
		}
	}

	process.on("exit", cleanup);
	process.on("SIGINT", () => {
		cleanup();
		process.exit(1);
	});
	process.on("SIGTERM", () => {
		cleanup();
		process.exit(1);
	});

	return { send, server, cleanup };
}

// ─── Assertion Helpers ──────────────────────────────────────────────────────

/** Initialize the MCP connection. */
export async function initClient(client: McpClient): Promise<void> {
	const res = await client.send("initialize", {
		protocolVersion: "2024-11-05",
		capabilities: {},
		clientInfo: { name: "verify-script", version: "1.0.0" },
	});
	if (res.error) throw new Error(`Init failed: ${res.error.message}`);
}

/** Call an MCP tool and return the result. Throws on error. */
export async function callTool(
	client: McpClient,
	name: string,
	args: Record<string, unknown> = {},
): Promise<McpResponse["result"]> {
	const res = await client.send("tools/call", { name, arguments: args });
	if (res.error || res.result?.isError) {
		const detail = res.error?.message || JSON.stringify(res.result);
		throw new Error(`Tool '${name}' failed: ${detail}`);
	}
	return res.result;
}

/** Extract the text content from a tool response. */
export function extractText(result: McpResponse["result"]): string {
	return result?.content?.[0]?.text ?? "";
}

/** Log a step header for readable output. */
export function step(label: string): void {
	console.log(`\n--- ${label} ---`);
}

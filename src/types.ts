import type { Subprocess } from "execa";
import type { WebSocket } from "ws";

// ─── Constants ───────────────────────────────────────────────────────────────

export const RPC_TIMEOUT_MS = 30_000;
export const APP_LAUNCH_TIMEOUT_MS = 180_000;
export const GRACEFUL_STOP_TIMEOUT_MS = 5_000;
export const MAX_LOG_LINES = 1_000;
export const SCREENSHOT_DIR = "flutter_pilot_screenshots";

// ─── Widget Finder Types ─────────────────────────────────────────────────────

export type FinderPayload =
	| { finderType: "byKey"; key: string }
	| { finderType: "byText"; text: string }
	| { finderType: "byType"; type: string }
	| { finderType: "byTooltip"; tooltip: string }
	| { finderType: "byId"; id: string };

// ─── JSON-RPC Protocol ──────────────────────────────────────────────────────

export interface JsonRpcRequest {
	readonly jsonrpc: "2.0";
	readonly method: string;
	readonly params: Record<string, unknown>;
	readonly id: string;
}

export interface JsonRpcResponse {
	readonly id?: string | number;
	readonly method?: string;
	readonly result?: unknown;
	readonly error?: { message: string };
}

// ─── Flutter Daemon Protocol ────────────────────────────────────────────────

export interface FlutterDaemonEvent {
	readonly event: string;
	readonly params?: {
		readonly wsUri?: string;
		readonly appId?: string;
		[key: string]: unknown;
	};
}

export interface FlutterDaemonCommand {
	readonly method: string;
	readonly params: Record<string, unknown>;
	readonly id: number;
}

export interface FlutterDevice {
	readonly name: string;
	readonly id: string;
	readonly targetPlatform: string;
	readonly isSupported: boolean;
}

// ─── Harness Responses ──────────────────────────────────────────────────────

export interface ScreenshotResult {
	readonly data: string;
	readonly format: string;
	readonly error?: string;
}

// ─── MCP Tool Response ──────────────────────────────────────────────────────

interface TextContent {
	type: "text";
	text: string;
	[key: string]: unknown;
}

interface ImageContent {
	type: "image";
	data: string;
	mimeType: string;
	[key: string]: unknown;
}

export type ContentItem = TextContent | ImageContent;

export interface ToolResponse {
	content: ContentItem[];
	isError?: boolean;
	[key: string]: unknown;
}

// ─── App Session State ──────────────────────────────────────────────────────

export interface AppSession {
	process: Subprocess;
	ws: WebSocket | null;
	appId: string | null;
	observatoryUri: string | null;
	projectPath: string;
	deviceId: string | null;
}

// ─── Tool Handler ───────────────────────────────────────────────────────────

export type ToolArgs = Record<string, unknown>;
export type ToolHandler = (args: ToolArgs) => Promise<ToolResponse>;

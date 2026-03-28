import WebSocket from "ws";
import {
	activeAppSession,
	appConnectedResolver,
	setAppConnectedResolver,
} from "../session.js";
import type { JsonRpcResponse } from "../types.js";
import { pendingRequests } from "./rpc.js";

const MAX_CONNECT_RETRIES = 30;
const RETRY_INTERVAL_MS = 1_000;

/** Shared message handler wired to every WebSocket connection. */
function attachMessageHandler(ws: WebSocket): void {
	ws.on("message", (data: Buffer) => {
		try {
			const msg = JSON.parse(data.toString()) as JsonRpcResponse;

			if (msg.id && pendingRequests.has(String(msg.id))) {
				const key = String(msg.id);
				const pending = pendingRequests.get(key);
				pendingRequests.delete(key);
				if (msg.error) {
					pending?.reject(
						new Error(msg.error.message || "Unknown error from device"),
					);
				} else {
					pending?.resolve(msg.result);
				}
			}

			if (msg.method === "app.started" && appConnectedResolver) {
				appConnectedResolver();
				setAppConnectedResolver(null);
			}
		} catch {
			console.error("Error parsing WebSocket message");
		}
	});
}

/**
 * Connect to the Dart harness's WebSocket server with retries.
 *
 * The harness starts an HttpServer on the given port inside the Flutter app.
 * We retry because the app takes time to boot and bind the port.
 *
 * On `close`, we automatically reconnect — this is critical for hot restart
 * support, where the Dart harness restarts and rebinds the port.
 */
export function connectToHarness(port: number): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		let attempt = 0;
		let initialConnectionMade = false;

		function tryConnect() {
			attempt++;
			const ws = new WebSocket(`ws://127.0.0.1:${port}`);

			ws.on("open", () => {
				console.error("Connected to Dart harness WebSocket server");
				attempt = 0; // Reset attempt counter on successful connection
				if (activeAppSession) activeAppSession.ws = ws;

				attachMessageHandler(ws);

				ws.on("close", () => {
					console.error("Dart harness disconnected");
					if (activeAppSession) {
						activeAppSession.ws = null;
						// Auto-reconnect after hot restart — the harness
						// will start a new WS server on the same port.
						console.error("Attempting to reconnect...");
						setTimeout(tryConnect, RETRY_INTERVAL_MS);
					}
				});

				if (!initialConnectionMade) {
					initialConnectionMade = true;
					resolve();
				}
			});

			ws.on("error", () => {
				ws.terminate();
				if (!initialConnectionMade && attempt >= MAX_CONNECT_RETRIES) {
					reject(
						new Error(
							`Could not connect to Dart harness WebSocket server on port ${port} after ${MAX_CONNECT_RETRIES} attempts`,
						),
					);
				} else if (attempt < MAX_CONNECT_RETRIES) {
					setTimeout(tryConnect, RETRY_INTERVAL_MS);
				}
			});
		}

		tryConnect();
	});
}

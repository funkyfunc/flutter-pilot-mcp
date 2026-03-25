import { type WebSocket, WebSocketServer } from "ws";
import {
	activeAppSession,
	appConnectedResolver,
	setAppConnectedResolver,
} from "../session.js";
import type { JsonRpcResponse } from "../types.js";
import { pendingRequests } from "./rpc.js";

let webSocketServer: WebSocketServer | null = null;
let webSocketPort: number | null = null;

export async function ensureWsServer(): Promise<number> {
	if (webSocketServer) return webSocketPort ?? 0;

	return new Promise<number>((resolve) => {
		webSocketServer = new WebSocketServer({ port: 0 });

		webSocketServer.on("listening", () => {
			const addr = webSocketServer?.address();
			if (typeof addr === "object" && addr !== null) {
				webSocketPort = addr.port;
				resolve(webSocketPort);
			}
		});

		webSocketServer.on("connection", (ws: WebSocket) => {
			console.error("Device connected via WebSocket");
			if (activeAppSession) activeAppSession.ws = ws;

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

			ws.on("close", () => {
				console.error("Device disconnected");
				if (activeAppSession) activeAppSession.ws = null;
			});
		});
	});
}

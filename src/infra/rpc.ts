import { activeAppSession, requireSession } from "../session.js";
import { RPC_TIMEOUT_MS } from "../types.js";

export const pendingRequests = new Map<
	string,
	{ resolve: (val: unknown) => void; reject: (err: Error) => void }
>();
export let nextRpcMessageId = 1;

export async function sendRpc(
	method: string,
	params: Record<string, unknown>,
): Promise<unknown> {
	if (!activeAppSession?.ws)
		throw new Error("App not connected. Use start_app first.");

	const id = `req_${nextRpcMessageId++}`;
	return new Promise<unknown>((resolve, reject) => {
		pendingRequests.set(id, { resolve, reject });
		activeAppSession?.ws?.send(
			JSON.stringify({ jsonrpc: "2.0", method, params, id }),
		);

		setTimeout(() => {
			if (pendingRequests.has(id)) {
				pendingRequests.delete(id);
				reject(new Error(`Timeout waiting for device response to '${method}'`));
			}
		}, RPC_TIMEOUT_MS);
	});
}

export function writeDaemonCommand(
	method: string,
	params: Record<string, unknown>,
): void {
	const s = requireSession();
	const cmd = `${JSON.stringify([{ method, params, id: nextRpcMessageId++ }])}\n`;
	s.process.stdin?.write(cmd);
}

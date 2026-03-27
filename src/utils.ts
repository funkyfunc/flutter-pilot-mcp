import type { FinderPayload, ToolResponse } from "./types.js";

export function parseTarget(target: string): FinderPayload {
	let trimmedTarget = target.trim();

	// Extract index=N suffix before parsing (emitted by explore_screen for disambiguation)
	let index: number | undefined;
	const indexMatch = trimmedTarget.match(/\s+index=(\d+)$/);
	if (
		indexMatch &&
		indexMatch[1] !== undefined &&
		indexMatch.index !== undefined
	) {
		index = Number.parseInt(indexMatch[1], 10);
		trimmedTarget = trimmedTarget.substring(0, indexMatch.index).trim();
	}

	let result: FinderPayload;

	if (trimmedTarget.startsWith("#")) {
		result = { finderType: "byKey", key: trimmedTarget.substring(1) };
	} else {
		const pairs = [
			...trimmedTarget.matchAll(/([a-zA-Z]+)\s*=\s*(["'])(.*?)\2/g),
		];
		if (pairs.length > 1) {
			const conditions: Record<string, string> = {};
			for (const match of pairs) {
				const key = match[1];
				const value = match[3];
				if (key && value !== undefined) {
					conditions[key] = value.replace(/\\n/g, "\n");
				}
			}
			result = { finderType: "byCompound", conditions };
		} else {
			const eqIndex = trimmedTarget.indexOf("=");
			if (eqIndex > 0) {
				const prefix = trimmedTarget.substring(0, eqIndex).trim();
				const value = trimmedTarget
					.substring(eqIndex + 1)
					.trim()
					.replace(/^['"`]|['"`]$/g, "")
					.replace(/\\n/g, "\n");

				switch (prefix) {
					case "text":
						result = { finderType: "byText", text: value };
						break;
					case "type":
						result = { finderType: "byType", type: value };
						break;
					case "tooltip":
						result = { finderType: "byTooltip", tooltip: value };
						break;
					case "id":
						if (/^\d+$/.test(value)) {
							result = { finderType: "byId", id: value };
						} else {
							result = { finderType: "byKey", key: value };
						}
						break;
					case "semanticsLabel":
						result = {
							finderType: "bySemanticsLabel",
							semanticsLabel: value,
						};
						break;
					default:
						result = {
							finderType: "byText",
							text: trimmedTarget
								.replace(/^['"`]|['"`]$/g, "")
								.replace(/\\n/g, "\n"),
						};
				}
			} else {
				// Fallback to text matching
				result = {
					finderType: "byText",
					text: trimmedTarget
						.replace(/^['"`]|['"`]$/g, "")
						.replace(/\\n/g, "\n"),
				};
			}
		}
	}

	if (index !== undefined) {
		result.index = index;
	}
	return result;
}

/** Safely extract a message from an unknown caught value. */
export function toErrorMessage(error: unknown): string {
	if (error instanceof Error) return error.message;
	return String(error);
}

/** Safely extract message + stderr from an execa error. */
export function toExecErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const stderr = (error as NodeJS.ErrnoException & { stderr?: string })
			.stderr;
		return stderr ? `${error.message}\nStderr: ${stderr}` : error.message;
	}
	return String(error);
}

/** Create a standard text-only MCP tool response. */
export function textResponse(text: string): ToolResponse {
	return { content: [{ type: "text" as const, text }] };
}

/** Create a standard JSON MCP tool response. */
export function jsonResponse(value: unknown, pretty = false): ToolResponse {
	const text = pretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
	const isError =
		typeof value === "object" &&
		value !== null &&
		("error" in value ||
			("success" in value &&
				(value as { success: unknown }).success === false));
	return {
		content: [{ type: "text" as const, text }],
		isError: isError ? true : undefined,
	};
}

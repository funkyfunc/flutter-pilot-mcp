import type { FinderPayload, ToolResponse } from "./types.js";

export function parseTarget(target: string): FinderPayload {
	const trimmedTarget = target.trim();

	if (trimmedTarget.startsWith("#")) {
		return { finderType: "byKey", key: trimmedTarget.substring(1) };
	}

	const eqIndex = trimmedTarget.indexOf("=");
	if (eqIndex > 0) {
		const prefix = trimmedTarget.substring(0, eqIndex).trim();
		const value = trimmedTarget
			.substring(eqIndex + 1)
			.trim()
			.replace(/^['"`]|['"`]$/g, "");

		switch (prefix) {
			case "text":
				return { finderType: "byText", text: value };
			case "type":
				return { finderType: "byType", type: value };
			case "tooltip":
				return { finderType: "byTooltip", tooltip: value };
			case "id":
				return { finderType: "byId", id: value };
			case "semanticsLabel":
				return { finderType: "bySemanticsLabel", semanticsLabel: value };
		}
	}

	// Fallback to text matching
	return {
		finderType: "byText",
		text: trimmedTarget.replace(/^['"`]|['"`]$/g, ""),
	};
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
		("error" in value || (value as any).success === false);
	return {
		content: [{ type: "text" as const, text }],
		isError: isError ? true : undefined,
	};
}

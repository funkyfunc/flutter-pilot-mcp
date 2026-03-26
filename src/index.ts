import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools } from "./tools.js";

async function main() {
	const server = new McpServer({
		name: "flutter-driver-mcp",
		version: "1.0.0",
	});

	registerTools(server);

	const transport = new StdioServerTransport();
	await server.connect(transport);
	console.error("Flutter Pilot MCP Server running on stdio");
}

main().catch((err) => {
	console.error("Fatal error starting MCP Server:", err);
	process.exit(1);
});

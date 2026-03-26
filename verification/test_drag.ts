import {
	callTool,
	createClient,
	extractText,
	initClient,
	TEST_APP_PATH,
} from "./helpers.js";

const client = createClient();
async function run() {
	await initClient(client);
	await callTool(client, "start_app", {
		project_path: TEST_APP_PATH,
		device_id: "macos",
	});
	await new Promise((r) => setTimeout(r, 2000));
	await callTool(client, "navigate_to", { route: "/reorder" });
	await new Promise((r) => setTimeout(r, 1000));
	const r1 = await callTool(client, "get_text", { target: "#index_Item A" });
	console.log("Before:", extractText(r1));
	await callTool(client, "drag_and_drop", {
		from: 'text="Item A"',
		to: 'text="Item C"',
		duration_ms: 2000,
	});
	await new Promise((r) => setTimeout(r, 1000));
	const r2 = await callTool(client, "get_text", { target: "#index_Item A" });
	console.log("After:", extractText(r2));
	await callTool(client, "stop_app");
	process.exit(0);
}
run().catch(console.error);

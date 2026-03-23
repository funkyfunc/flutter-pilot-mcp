import { execa } from "execa";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main(): Promise<void> {
	console.log("[Verify] Starting Dart Harness Syntax Verification...");

	// Read the harness source directly — same file that gets inlined at build time
	const harnessSourcePath = path.resolve(__dirname, "../src/harness.dart");
	const dartCode = (await fs.readFile(harnessSourcePath, "utf-8"))
		.replace("// INJECT_IMPORT", "import 'package:test_app/main.dart' as app;")
		.replace("// INJECT_MAIN", "app.main();");

	const testAppPath = path.resolve(__dirname, "../test_app");
	const integrationTestDir = path.join(testAppPath, "integration_test");
	const harnessFilePath = path.join(integrationTestDir, "mcp_harness.dart");

	try {
		await fs.mkdir(integrationTestDir, { recursive: true });
		await fs.writeFile(harnessFilePath, dartCode, "utf-8");
		console.log(`[Verify] Wrote generated harness to ${harnessFilePath}`);

		console.log('[Verify] Running "dart analyze"...');
		const result = await execa(
			"dart",
			["analyze", "integration_test/mcp_harness.dart"],
			{
				cwd: testAppPath,
				reject: false,
			},
		);

		console.log(`[Debug] exitCode=${result.exitCode}`);
		const errorLines = result.stdout
			.split("\n")
			.filter((line) => line.includes("error -"));
		if (errorLines.length > 0) {
			console.log(`❌ ACTUAL ERRORS FOUND:\n${errorLines.join("\n")}`);
			process.exit(1);
		}

		console.log("✅ [Verify] SUCCESS: Harness Dart code has no syntax errors!");
		process.exit(0);
	} catch (e) {
		console.log(`[Debug] CAUGHT EXCEPTION: ${e}`);
		process.exit(1);
	} finally {
		try {
			await fs.unlink(harnessFilePath);
		} catch {
			/* ignore */
		}
	}
}

main();

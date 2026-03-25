import fs from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { toErrorMessage } from "../utils.js";

async function checkPubspecDependencies(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const pubspecPath = path.join(projectPath, "pubspec.yaml");
	try {
		const pubspec = await fs.readFile(pubspecPath, "utf-8");
		let success = true;

		for (const [dep, fixArgs] of [
			["integration_test", ["pub", "add", "integration_test", "--sdk=flutter"]],
			["web_socket_channel", ["pub", "add", "web_socket_channel"]],
			["path_provider", ["pub", "add", "path_provider"]],
		] as const) {
			if (!pubspec.includes(`${dep}:`)) {
				report.push(`❌ Missing '${dep}' in pubspec.yaml.`);
				success = false;
				if (autoFix) {
					await execa("flutter", [...fixArgs], { cwd: projectPath });
					report.push(`✅ Added '${dep}'.`);
				}
			} else {
				report.push(`✅ '${dep}' found.`);
			}
		}
		return success;
	} catch (e) {
		report.push(`❌ Could not read pubspec.yaml: ${toErrorMessage(e)}`);
		return false;
	}
}

async function checkMacOsEntitlements(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const entitlementsPath = path.join(
		projectPath,
		"macos/Runner/DebugProfile.entitlements",
	);
	try {
		await fs.access(entitlementsPath);
	} catch {
		return true; // skip
	}

	const content = await fs.readFile(entitlementsPath, "utf-8");
	if (content.includes("com.apple.security.network.client")) {
		report.push("✅ macOS network client entitlement found.");
		return true;
	}

	report.push(
		"❌ Missing 'com.apple.security.network.client' in DebugProfile.entitlements.",
	);
	if (!autoFix) return false;

	const idx = content.lastIndexOf("</dict>");
	if (idx !== -1) {
		const patched =
			content.slice(0, idx) +
			"\\t<key>com.apple.security.network.client</key>\\n\\t<true/>\\n" +
			content.slice(idx);
		await fs.writeFile(entitlementsPath, patched);
		report.push(
			"✅ Added network client entitlement to DebugProfile.entitlements.",
		);
		return true;
	}
	report.push("⚠️ Could not auto-fix entitlements (structure mismatch).");
	return false;
}

async function checkAndroidPermissions(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const androidMain = path.join(
		projectPath,
		"android/app/src/main/AndroidManifest.xml",
	);
	const androidDebug = path.join(
		projectPath,
		"android/app/src/debug/AndroidManifest.xml",
	);

	try {
		await fs.access(androidMain);
	} catch {
		return true; // skip
	}

	const mainManifest = await fs.readFile(androidMain, "utf-8");
	let hasInternet = mainManifest.includes("android.permission.INTERNET");

	if (!hasInternet) {
		try {
			const debugManifest = await fs.readFile(androidDebug, "utf-8");
			hasInternet = debugManifest.includes("android.permission.INTERNET");
		} catch {}
	}

	if (hasInternet) {
		report.push("✅ Android INTERNET permission found.");
		return true;
	}

	report.push(
		"❌ Missing 'android.permission.INTERNET' in AndroidManifest.xml (main or debug).",
	);
	if (!autoFix) return false;

	try {
		let debugContent: string;
		try {
			debugContent = await fs.readFile(androidDebug, "utf-8");
		} catch {
			debugContent =
				'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">\\n</manifest>';
			await fs.mkdir(path.dirname(androidDebug), { recursive: true });
		}

		if (debugContent.includes("</manifest>")) {
			const patched = debugContent.replace(
				"</manifest>",
				'    <uses-permission android:name="android.permission.INTERNET"/>\\n</manifest>',
			);
			await fs.writeFile(androidDebug, patched);
			report.push("✅ Added INTERNET permission to debug AndroidManifest.xml.");
			return true;
		}

		report.push(
			"⚠️ Could not auto-fix AndroidManifest.xml (structure mismatch).",
		);
		return false;
	} catch (e) {
		report.push(
			`⚠️ Failed to auto-fix Android permissions: ${toErrorMessage(e)}`,
		);
		return false;
	}
}

async function ensureHarnessInGitignore(
	projectPath: string,
	autoFix: boolean,
	report: string[],
): Promise<boolean> {
	const gitignorePath = path.join(projectPath, ".gitignore");
	try {
		await fs.access(gitignorePath);
	} catch {
		return true; // skip
	}

	const gitignore = await fs.readFile(gitignorePath, "utf-8");
	if (gitignore.includes("integration_test/mcp_harness.dart")) {
		return true;
	}

	if (autoFix) {
		await fs.appendFile(
			gitignorePath,
			"\\n# Flutter Pilot MCP Harness\\nintegration_test/mcp_harness.dart\\n",
		);
		report.push("✅ Added 'integration_test/mcp_harness.dart' to .gitignore.");
		return true;
	}

	report.push("❌ Missing 'integration_test/mcp_harness.dart' in .gitignore.");
	return false;
}

export async function handleValidateProject(args: {
	project_path: string;
	auto_fix?: boolean;
}) {
	const projectPath = args.project_path;
	const autoFix = args.auto_fix ?? false;
	const report: string[] = [];

	const pubspecOk = await checkPubspecDependencies(
		projectPath,
		autoFix,
		report,
	);
	const macosOk = await checkMacOsEntitlements(projectPath, autoFix, report);
	const androidOk = await checkAndroidPermissions(projectPath, autoFix, report);

	try {
		await fs.access(path.join(projectPath, "web/index.html"));
		report.push("✅ Web index.html found.");
	} catch {}

	const gitignoreOk = await ensureHarnessInGitignore(
		projectPath,
		autoFix,
		report,
	);
	const success = pubspecOk && macosOk && androidOk && gitignoreOk;

	return {
		content: [{ type: "text" as const, text: report.join("\\n") }],
		isError: !success && !autoFix,
	};
}

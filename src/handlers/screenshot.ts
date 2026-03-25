import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { sendRpc } from "../infra/rpc.js";
import { type activeAppSession, requireSession } from "../session.js";
import { SCREENSHOT_DIR, type ScreenshotResult } from "../types.js";
import { textResponse } from "../utils.js";

async function captureAppRenderScreenshot(savePath?: string) {
	const result = (await sendRpc("screenshot", {})) as ScreenshotResult;
	if (result.error) throw new Error(result.error);

	if (savePath) {
		await fs.writeFile(savePath, Buffer.from(result.data, "base64"));
		return textResponse(`Screenshot saved to ${savePath}`);
	}
	return {
		content: [
			{ type: "text" as const, text: "Screenshot captured:" },
			{ type: "image" as const, data: result.data, mimeType: "image/png" },
		],
	};
}

async function captureNativeDeviceScreenshot(
	currentSession: NonNullable<typeof activeAppSession>,
	screenshotType: string,
	savePath?: string,
) {
	if (!currentSession.observatoryUri) {
		throw new Error(
			"Observatory URI not available. Screenshot requires a debug/profile build with VM service enabled.",
		);
	}

	const tempDir = path.join(os.tmpdir(), SCREENSHOT_DIR);
	await fs.mkdir(tempDir, { recursive: true });
	const tempPath = path.join(tempDir, `screenshot_${Date.now()}.png`);

	const screenshotArgs = [
		"screenshot",
		`--type=${screenshotType}`,
		"-o",
		tempPath,
	];
	if (screenshotType !== "device")
		screenshotArgs.push(`--vm-service-url=${currentSession.observatoryUri}`);
	if (currentSession.deviceId)
		screenshotArgs.push("-d", currentSession.deviceId);

	console.error(`Taking screenshot via: flutter ${screenshotArgs.join(" ")}`);

	try {
		await execa("flutter", screenshotArgs, { cwd: currentSession.projectPath });
	} catch (flutterErr) {
		if (currentSession.deviceId === "macos" && screenshotType === "device") {
			console.error(
				"Flutter screenshot failed, falling back to macOS screencapture...",
			);
			await execa("screencapture", ["-x", tempPath]);
		} else {
			throw flutterErr;
		}
	}

	await fs.access(tempPath);

	if (savePath) {
		await fs.copyFile(tempPath, savePath);
		return textResponse(`Screenshot saved to ${savePath}`);
	}

	const buffer = await fs.readFile(tempPath);
	await fs.unlink(tempPath);
	return {
		content: [
			{ type: "text" as const, text: "Screenshot captured:" },
			{
				type: "image" as const,
				data: buffer.toString("base64"),
				mimeType: "image/png",
			},
		],
	};
}

export async function handleTakeScreenshot(args: {
	save_path?: string;
	type?: string;
}) {
	const currentSession = requireSession();
	const savePath = args.save_path;
	const screenshotType = args.type || "app";

	if (screenshotType === "app") {
		return captureAppRenderScreenshot(savePath);
	}
	return captureNativeDeviceScreenshot(
		currentSession,
		screenshotType,
		savePath,
	);
}

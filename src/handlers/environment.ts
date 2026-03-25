import { execa } from "execa";
import { activeAppSession } from "../session.js";
import { textResponse } from "../utils.js";

export async function handleSimulateBackground(args: { duration_ms?: number }) {
	const durationMs = args.duration_ms ?? 2000;
	const deviceId = activeAppSession?.deviceId;

	if (deviceId?.includes("-")) {
		try {
			await execa("xcrun", [
				"simctl",
				"launch",
				deviceId,
				"com.apple.springboard",
			]);
			await new Promise((r) => setTimeout(r, durationMs));
		} catch {}
		return textResponse(
			"Simulated backgrounding via simctl (Note: resuming might require manual tap if bundle ID is unknown)",
		);
	}

	if (deviceId?.startsWith("emulator-")) {
		try {
			await execa("adb", [
				"-s",
				deviceId,
				"shell",
				"input",
				"keyevent",
				"KEYCODE_HOME",
			]);
			await new Promise((r) => setTimeout(r, durationMs));
		} catch {}
		return textResponse("Simulated backgrounding via adb");
	}

	return textResponse("Device not supported for simulate_background");
}

export async function handleSetNetworkStatus(args: { wifi: boolean }) {
	const { wifi } = args;
	const deviceId = activeAppSession?.deviceId;

	if (deviceId?.includes("-")) {
		return textResponse(
			"Network toggling in iOS simulators is complex and usually requires external proxies. " +
				"Consider using 'intercept_network' instead.",
		);
	}

	if (deviceId?.startsWith("emulator-")) {
		await execa("adb", [
			"-s",
			deviceId,
			"shell",
			"svc",
			"wifi",
			wifi ? "enable" : "disable",
		]);
		return textResponse(`Set WiFi to ${wifi} via adb`);
	}

	return textResponse("Device not supported for set_network_status");
}

import { execa } from "execa";

/**
 * Determines if a device ID refers to an Android device.
 *
 * Android emulators use IDs like "emulator-5554".
 * Physical Android devices use their serial number (e.g. "R5CT32XXXXX").
 * Non-Android targets: "macos", "chrome", iOS UUIDs (36-char hex with dashes).
 */
export function isAndroidDevice(deviceId: string | null): boolean {
	if (!deviceId) return false;

	// Well-known non-Android device IDs
	const nonAndroidIds = ["macos", "chrome", "linux", "windows", "web-server"];
	if (nonAndroidIds.includes(deviceId.toLowerCase())) return false;

	// iOS simulator UUIDs are 36-char hex strings with dashes
	// e.g. "EC5B35E0-F7BF-48CA-AAD5-85D75FDD78C7"
	if (/^[0-9A-F]{8}-([0-9A-F]{4}-){3}[0-9A-F]{12}$/i.test(deviceId)) {
		return false;
	}

	// Android emulators: "emulator-5554", "emulator-5556", etc.
	if (deviceId.startsWith("emulator-")) return true;

	// Physical Android devices typically have alphanumeric serial numbers.
	// If it doesn't match any of the above patterns, it's likely Android.
	return true;
}

/**
 * Sets up adb port forwarding so that the host can reach the harness
 * WebSocket server running inside the Android emulator.
 *
 * The harness binds to 127.0.0.1:PORT inside the emulator, which is
 * isolated from the host's loopback interface. `adb forward` bridges
 * the port so that ws://127.0.0.1:PORT on the host reaches the emulator.
 */
export async function setupAndroidPortForward(
	deviceId: string,
	port: number,
): Promise<void> {
	try {
		await execa("adb", [
			"-s",
			deviceId,
			"forward",
			`tcp:${port}`,
			`tcp:${port}`,
		]);
		console.error(
			`Set up adb port forwarding: host:${port} → emulator:${port}`,
		);
	} catch (err) {
		console.error(
			`Warning: Failed to set up adb port forwarding on port ${port}: ${err}`,
		);
		// Don't throw — the connection attempt will fail with a clearer error
	}
}

/**
 * Removes all adb port forwarding rules for a device.
 * Called during stop_app cleanup.
 */
export async function removeAndroidPortForward(
	deviceId: string,
): Promise<void> {
	try {
		await execa("adb", ["-s", deviceId, "forward", "--remove-all"]);
		console.error(`Removed adb port forwarding for ${deviceId}`);
	} catch {
		// Best-effort cleanup — device may already be gone
	}
}

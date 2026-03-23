import harnessSource from "./harness.dart";

export function getHarnessCode(packageName?: string): string {
	return packageName
		? harnessSource
				.replace(
					"// INJECT_IMPORT",
					`import 'package:${packageName}/main.dart' as app;`,
				)
				.replace("// INJECT_MAIN", "app.main();")
		: harnessSource;
}

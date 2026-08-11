import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop WebView2 installer", () => {
  it("uses Tauri bootstrapper, which checks WebView2 before downloading it", () => {
    const config = JSON.parse(
      readFileSync(resolve(process.cwd(), "desktop/src-tauri/tauri.conf.json"), "utf8"),
    ) as {
      bundle?: {
        windows?: {
          webviewInstallMode?: { type?: string };
        };
      };
    };

    expect(config.bundle?.windows?.webviewInstallMode?.type).toBe("downloadBootstrapper");
  });
});

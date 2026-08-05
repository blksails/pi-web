import { describe, expect, it } from "vitest";
import { controlledBrowserOrigins, isControlledBrowserOrigin, normaliseBrowserUrl } from "../src/browser-policy.js";

describe("browser pane navigation policy", () => {
  it("只接受 http/https，拒绝凭据 URL", () => {
    expect(normaliseBrowserUrl("localhost:5173")?.origin).toBe("https://localhost:5173");
    expect(normaliseBrowserUrl("javascript:alert(1)")).toBeUndefined();
    expect(normaliseBrowserUrl("https://user:secret@example.com")).toBeUndefined();
  });

  it("允许宿主来源与 loopback，拒绝任意公网来源", () => {
    const origins = controlledBrowserOrigins("https://pi.example.com/session/1");
    expect(isControlledBrowserOrigin(new URL("https://pi.example.com/pane"), origins)).toBe(true);
    expect(isControlledBrowserOrigin(new URL("http://127.0.0.1:3000"), origins)).toBe(true);
    expect(isControlledBrowserOrigin(new URL("https://example.com"), origins)).toBe(false);
  });
});

/**
 * Task 3.3 — SLOTS.logs constant and WebExtHostContext.logger type seam.
 *
 * RED→GREEN: written before implementation, now GREEN after slots.ts change.
 */
import { describe, expect, it } from "vitest";
import { SLOTS } from "../src/slots.js";
import type { WebExtHostContext } from "../src/host-context.js";
import type { Logger } from "@pi-web/logger";
import { createLogger } from "@pi-web/logger";

describe("SLOTS.logs (task 3.3)", () => {
  it('SLOTS.logs equals "logs"', () => {
    expect(SLOTS.logs).toBe("logs");
  });

  it("SLOTS.logs is a string constant (not undefined)", () => {
    expect(typeof SLOTS.logs).toBe("string");
  });
});

describe("WebExtHostContext.logger type seam (task 3.3)", () => {
  it("WebExtHostContext accepts an object with a logger field of type Logger", () => {
    // Compile-time type check: if logger is not on the interface, TypeScript
    // rejects the cast below — caught at typecheck / test compilation.
    const fakeLogger: Logger = createLogger({ namespace: "ext:test" });
    const ctx: WebExtHostContext = {
      extId: "test-ext",
      rpc: {} as WebExtHostContext["rpc"],
      theme: {},
      logger: fakeLogger,
    };
    expect(ctx.logger).toBe(fakeLogger);
    expect(ctx.extId).toBe("test-ext");
  });
});

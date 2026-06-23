/**
 * Task 3.3 — "logs" SlotKey: SlotKeySchema must accept "logs".
 * RED→GREEN: written before implementation, now GREEN after descriptor.ts change.
 */
import { describe, expect, it } from "vitest";
import { SlotKeySchema } from "../../src/web-ext/descriptor.js";

describe("SlotKey: logs (task 3.3)", () => {
  it('SlotKeySchema accepts "logs"', () => {
    expect(SlotKeySchema.safeParse("logs").success).toBe(true);
  });

  it('"logs" round-trips through SlotKeySchema.parse', () => {
    expect(SlotKeySchema.parse("logs")).toBe("logs");
  });

  it("still rejects unknown slot keys after adding logs", () => {
    expect(SlotKeySchema.safeParse("logsPanel").success).toBe(false);
    expect(SlotKeySchema.safeParse("").success).toBe(false);
  });
});

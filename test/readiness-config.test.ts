import { describe, expect, it } from "vitest";
import {
  READY_TIMEOUT_ENV,
  readyTimeoutFromEnv,
} from "@/lib/app/readiness-config";

describe("readyTimeoutFromEnv", () => {
  it("accepts a positive integer override", () => {
    expect(
      readyTimeoutFromEnv({
        [READY_TIMEOUT_ENV]: "60000",
      }),
    ).toBe(60_000);
  });

  it.each([undefined, "", "0", "-1", "1.5", "abc", "9007199254740992"])(
    "preserves the PiSession default for invalid value %s",
    (value) => {
      expect(
        readyTimeoutFromEnv({
          [READY_TIMEOUT_ENV]: value,
        }),
      ).toBeUndefined();
    },
  );

  it("no longer reads the removed probe-era env name (rename, not overlay)", () => {
    expect(
      readyTimeoutFromEnv({ PI_WEB_READINESS_PROBE_TIMEOUT_MS: "60000" }),
    ).toBeUndefined();
  });
});

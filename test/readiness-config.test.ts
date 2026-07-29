import { describe, expect, it } from "vitest";
import {
  READINESS_PROBE_TIMEOUT_ENV,
  readinessProbeTimeoutFromEnv,
} from "@/lib/app/readiness-config";

describe("readinessProbeTimeoutFromEnv", () => {
  it("accepts a positive integer override", () => {
    expect(
      readinessProbeTimeoutFromEnv({
        [READINESS_PROBE_TIMEOUT_ENV]: "60000",
      }),
    ).toBe(60_000);
  });

  it.each([undefined, "", "0", "-1", "1.5", "abc", "9007199254740992"])(
    "preserves the PiSession default for invalid value %s",
    (value) => {
      expect(
        readinessProbeTimeoutFromEnv({
          [READINESS_PROBE_TIMEOUT_ENV]: value,
        }),
      ).toBeUndefined();
    },
  );
});

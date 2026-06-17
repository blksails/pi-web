import { describe, expect, it } from "vitest";
import { SpawnSpecSchema } from "../../src/transport/spawn.js";

const valid = {
  cmd: "node",
  args: ["dist/cli.js", "--mode", "rpc"],
  cwd: "/work",
  env: { ANTHROPIC_API_KEY: "sk-x" },
};

describe("SpawnSpecSchema", () => {
  it("parses a fully-specified spawn spec", () => {
    expect(SpawnSpecSchema.parse(valid)).toEqual(valid);
  });

  it("rejects when any required field is missing (field path reported)", () => {
    for (const field of ["cmd", "args", "cwd", "env"] as const) {
      const clone: Record<string, unknown> = { ...valid };
      delete clone[field];
      const res = SpawnSpecSchema.safeParse(clone);
      expect(res.success, `missing ${field} should fail`).toBe(false);
      if (!res.success) {
        expect(res.error.issues.some((i) => i.path.includes(field))).toBe(true);
      }
    }
  });

  it("rejects wrong field types", () => {
    expect(SpawnSpecSchema.safeParse({ ...valid, args: "ls" }).success).toBe(false);
    expect(SpawnSpecSchema.safeParse({ ...valid, env: { k: 1 } }).success).toBe(false);
  });
});

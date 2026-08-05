import { describe, expect, it } from "vitest";
import { withAgentCompileCache } from "../lib/app/agent-compile-cache.js";

describe("withAgentCompileCache", () => {
  it("defaults to a user-scoped cache without mutating the input", () => {
    const input = { PATH: "path" };
    const result = withAgentCompileCache(input, "C:/Users/test");
    expect(result.NODE_COMPILE_CACHE).toBe("C:\\Users\\test\\.pi-web\\cache\\node-compile");
    expect(input).toEqual({ PATH: "path" });
  });

  it("preserves explicit cache and disable settings", () => {
    expect(withAgentCompileCache({ NODE_COMPILE_CACHE: "C:/cache" }, "C:/home").NODE_COMPILE_CACHE).toBe("C:/cache");
    expect(withAgentCompileCache({ NODE_DISABLE_COMPILE_CACHE: "1" }, "C:/home").NODE_COMPILE_CACHE).toBeUndefined();
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeProjectTrustPolicy } from "../../src/trust/index.js";

/**
 * C-P4:makeProjectTrustPolicy —— 复用 SDK ProjectTrustStore(指向临时 agentDir,
 * 不污染真实 ~/.pi/agent/trust.json),验证四层决策优先级与显式放行落库。
 */
describe("makeProjectTrustPolicy", () => {
  let agentDir: string;

  beforeAll(async () => {
    agentDir = await mkdtemp(path.join(tmpdir(), "pi-web-trust-"));
  });
  afterAll(async () => {
    await rm(agentDir, { recursive: true, force: true });
  });

  it("默认(无显式/无持久/无 roots)→ ask", () => {
    const policy = makeProjectTrustPolicy({ agentDir });
    expect(policy({ dir: "/proj/a", source: "/proj/a" })).toBe("ask");
  });

  it("requestTrust=false → never", () => {
    const policy = makeProjectTrustPolicy({ agentDir });
    expect(policy({ dir: "/proj/b", source: "/proj/b", requestTrust: false })).toBe(
      "never",
    );
  });

  it("requestTrust=true → always,并落库 → 后续(无显式)仍 always", () => {
    const dir = "/proj/c";
    const policy = makeProjectTrustPolicy({ agentDir });
    expect(policy({ dir, source: dir, requestTrust: true })).toBe("always");
    // 新建一个 policy(重新读库),证明已持久化。
    const fresh = makeProjectTrustPolicy({ agentDir });
    expect(fresh({ dir, source: dir })).toBe("always");
  });

  it("trustedRoots 前缀匹配 → always", () => {
    const policy = makeProjectTrustPolicy({
      agentDir,
      trustedRoots: ["/work/trusted"],
    });
    expect(policy({ dir: "/work/trusted/proj", source: "x" })).toBe("always");
    expect(policy({ dir: "/work/other/proj", source: "x" })).toBe("ask");
  });

  it("显式 requestTrust 优先于 trustedRoots(false 拒绝即使在受信根下)", () => {
    const policy = makeProjectTrustPolicy({
      agentDir,
      trustedRoots: ["/work/trusted"],
    });
    expect(
      policy({ dir: "/work/trusted/proj", source: "x", requestTrust: false }),
    ).toBe("never");
  });
});

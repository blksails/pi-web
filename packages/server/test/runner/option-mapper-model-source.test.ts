/**
 * option-mapper · 模型解析失败的来源提示(spec ai-gateway-session-models,任务 1.4,
 * Req 1.4/4.2)。
 *
 * 经 `buildRuntimeFactory` 的公开路径验证 —— `resolveModel` 是模块私有函数,
 * 但会话构造会调它,故以「构造一个引用了未注册模型的 runtime」触发。
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AI_GATEWAY_PROVIDER_NAME } from "../../src/ai-gateway/session-model-source.js";
import { buildRuntimeFactory } from "../../src/runner/option-mapper.js";

async function attemptBuild(provider: string, modelId: string, agentDir: string) {
  const factory = buildRuntimeFactory(
    { name: "t", model: { provider, modelId } } as never,
    async () => "trusted" as never,
  );
  return await factory({
    cwd: agentDir,
    agentDir,
    sessionManager: undefined as never,
  } as never);
}

describe("resolveModel — 失败文案按来源分化", () => {
  let agentDir: string;

  beforeEach(() => {
    agentDir = mkdtempSync(join(tmpdir(), "pi-optmap-"));
  });
  afterEach(() => {
    rmSync(agentDir, { recursive: true, force: true });
  });

  // 裸抛注册表内部文案会让用户无从下手:网关来源的失败有其特有成因
  // (套件未启用 / 目录已变 / 该条目非对话模型)。
  it("网关来源 → 文案含来源与常见成因指引", async () => {
    await expect(
      attemptBuild(AI_GATEWAY_PROVIDER_NAME, "openai/nonexistent-model", agentDir),
    ).rejects.toThrow(/ai-gateway 目录/);
    await expect(
      attemptBuild(AI_GATEWAY_PROVIDER_NAME, "openai/nonexistent-model", agentDir),
    ).rejects.toThrow(/常见成因/);
  });

  it("网关来源的文案仍含 provider 与 modelId(可定位)", async () => {
    await expect(
      attemptBuild(AI_GATEWAY_PROVIDER_NAME, "openai/nonexistent-model", agentDir),
    ).rejects.toThrow(/provider="ai-gateway" modelId="openai\/nonexistent-model"/);
  });

  // 非网关来源的文案必须逐字不变 —— 本 spec 不改既有行为。
  it("非网关来源 → 文案不含网关提示", async () => {
    await expect(attemptBuild("openrouter", "nope", agentDir)).rejects.toThrow(
      /Model not found in registry/,
    );
    await expect(attemptBuild("openrouter", "nope", agentDir)).rejects.not.toThrow(
      /ai-gateway 目录/,
    );
  });
});

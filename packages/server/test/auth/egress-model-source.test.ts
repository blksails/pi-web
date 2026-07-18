/**
 * desktop-cloud-login 任务 7.1 · 会话模型来源工厂单测(Req 3.1/3.2/3.3/4.1/4.3/5.1/5.2)。
 *
 * 验证:登录态注入仅含 `pi-cloud` provider(authHeader=true)的内存 registry、复用共享 auth.json、
 * 不落盘;缺凭据/缺 base/无模型 → undefined(走 SDK 默认)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildEgressModelSource,
  resolveEgressModelSourceFromEnv,
  EGRESS_PROVIDER_NAME,
} from "../../src/auth/egress-model-source.js";

let agentDir: string;

beforeEach(async () => {
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "dcl-egress-"));
});
afterEach(async () => {
  await fs.rm(agentDir, { recursive: true, force: true });
});

const models = [{ id: "test-model", name: "Test Model" }];
const credential = "cred.sig";
const egressBaseUrl = "https://egress.example/v1";

describe("buildEgressModelSource", () => {
  it("登录态:返回内存 registry,含 pi-cloud provider 且能解析其模型", () => {
    const injected = buildEgressModelSource({
      agentDir,
      egressBaseUrl,
      credential,
      models,
    });
    expect(injected).toBeDefined();
    const registry = injected!.modelRegistry;
    // pi SDK ModelRegistry.find(provider, modelId):注册的 pi-cloud 模型可被找到。
    const found = registry.find(EGRESS_PROVIDER_NAME, "test-model");
    expect(found).toBeDefined();
  });

  it("不落盘:构造后共享 agentDir 下不产生 models.json(Req 5.3)", async () => {
    buildEgressModelSource({ agentDir, egressBaseUrl, credential, models });
    const entries = await fs.readdir(agentDir);
    expect(entries).not.toContain("models.json");
  });

  it.each([
    ["缺凭据", { agentDir, egressBaseUrl, credential: undefined, models }],
    ["缺 base", { agentDir, egressBaseUrl: undefined, credential, models }],
    ["空模型", { agentDir, egressBaseUrl, credential, models: [] }],
    ["空白凭据", { agentDir, egressBaseUrl, credential: "  ", models }],
  ])("未满足(%s)→ undefined(走 SDK 默认,Req 4.1)", (_label, input) => {
    expect(
      buildEgressModelSource(input as Parameters<typeof buildEgressModelSource>[0]),
    ).toBeUndefined();
  });
});

describe("resolveEgressModelSourceFromEnv", () => {
  it("三 env 齐备 → 注入项", () => {
    const env: NodeJS.ProcessEnv = {
      PI_WEB_CLOUD_EGRESS_BASE: egressBaseUrl,
      PI_WEB_DESKTOP_CREDENTIAL: credential,
      PI_WEB_CLOUD_EGRESS_MODELS: JSON.stringify(models),
    };
    expect(resolveEgressModelSourceFromEnv(agentDir, env)).toBeDefined();
  });

  it("缺任一 env → undefined", () => {
    expect(
      resolveEgressModelSourceFromEnv(agentDir, {
        PI_WEB_CLOUD_EGRESS_BASE: egressBaseUrl,
        PI_WEB_DESKTOP_CREDENTIAL: credential,
        // 缺 models
      }),
    ).toBeUndefined();
  });

  it("模型 JSON 非法 → undefined(不打断本地路径)", () => {
    expect(
      resolveEgressModelSourceFromEnv(agentDir, {
        PI_WEB_CLOUD_EGRESS_BASE: egressBaseUrl,
        PI_WEB_DESKTOP_CREDENTIAL: credential,
        PI_WEB_CLOUD_EGRESS_MODELS: "{not json",
      }),
    ).toBeUndefined();
  });
});

/**
 * host-assembly · custom-providers 单测(spec multi-gateway-providers,任务 5.3
 * 修复轮,Req 7.2, 7.5)。
 *
 * 两组断言:
 * 1. 正常路径:`providers.json` 里的条目正确进入 `ProviderRegistry`(`providers()`/`find()`)。
 * 2. fail-soft 路径:标识冲突(重复 id)时 `createProviderRegistry` 会抛
 *    `ProviderIdConflictError`(任务 1.3 的契约)——本模块必须吞掉该错误、退回空注册表,
 *    而不是让 `GET /api/config/models` 因一份被手工改坏的配置文件而 500。这是本轮
 *    debug 指出的、fail-fast 落在每请求路径上的新风险,须显式测试覆盖(不能只靠
 *    「代码里写了 try/catch」这种自证)。
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCustomProviderRegistry } from "../../src/host-assembly/custom-providers.js";

function withAgentDir(run: (agentDir: string) => void): void {
  const agentDir = mkdtempSync(join(tmpdir(), "pi-web-custom-providers-hostassembly-"));
  try {
    run(agentDir);
  } finally {
    rmSync(agentDir, { recursive: true, force: true });
  }
}

function writeProvidersJson(agentDir: string, body: unknown): void {
  writeFileSync(join(agentDir, "providers.json"), JSON.stringify(body), "utf8");
}

describe("createCustomProviderRegistry", () => {
  it("正常读取 providers.json:条目进入注册表,可被 providers()/find() 查到", () => {
    withAgentDir((agentDir) => {
      writeProvidersJson(agentDir, {
        providers: [
          {
            id: "acme",
            baseUrl: "https://acme.example.com/v1",
            apiKey: "sk-acme",
            models: [{ id: "m1" }],
          },
        ],
      });

      const registry = createCustomProviderRegistry(agentDir);
      expect(registry.providers().map((p) => p.id)).toEqual(["acme"]);
      expect(registry.find("acme")).toBeDefined();
    });
  });

  it("providers.json 不存在时,退回空注册表(与该来源不存在时一致)", () => {
    withAgentDir((agentDir) => {
      const registry = createCustomProviderRegistry(agentDir);
      expect(registry.providers()).toEqual([]);
      expect(registry.find("anything")).toBeUndefined();
    });
  });

  it("标识冲突(providers.json 内两条同 id)时不抛错,退回空注册表(fail-soft,防 GET /api/config/models 500)", () => {
    withAgentDir((agentDir) => {
      writeProvidersJson(agentDir, {
        providers: [
          {
            id: "dup",
            baseUrl: "https://a.example.com/v1",
            apiKey: "sk-a",
            models: [{ id: "m1" }],
          },
          {
            id: "dup",
            baseUrl: "https://b.example.com/v1",
            apiKey: "sk-b",
            models: [{ id: "m2" }],
          },
        ],
      });

      expect(() => createCustomProviderRegistry(agentDir)).not.toThrow();
      const registry = createCustomProviderRegistry(agentDir);
      expect(registry.providers()).toEqual([]);
      expect(registry.find("dup")).toBeUndefined();
    });
  });
});

/**
 * 云端地址「env 优先、回落配置域」(spec desktop-cloud-login 任务 8.3,Req 8.3/8.4/8.5/8.6)。
 *
 * ★ 该回落存在的唯一理由:打包桌面版拿不到任何环境变量 —— 壳的 base_env() 不转发、
 *   Finder 双击无 shell 环境、服务端 .env 从 cwd 读而打包态 cwd 是会被 GC 的运行时目录。
 *   实测后果是 `GET /api/auth/me` 404、登录入口不渲染,即 Req 1.1 在打包态不成立。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveCloudLoginConfig,
  readCloudDomainEgressBase,
  CloudLoginConfigError,
  CLOUD_LOGIN_EGRESS_BASE_ENV,
} from "@/lib/app/auth-egress-assembly";

const ENV_BASE = "https://env.example/api/desktop/egress/v1";
const FILE_BASE = "https://file.example/api/desktop/egress/v1";

let agentDir: string;
const trash: string[] = [];

function writeCloudJson(body: string): void {
  writeFileSync(join(agentDir, "cloud.json"), body);
}

beforeEach(() => {
  agentDir = mkdtempSync(join(tmpdir(), "pi-cloud-domain-"));
  trash.push(agentDir);
});

afterEach(() => {
  for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("readCloudDomainEgressBase — 容错读取", () => {
  it("读出 egressBase", () => {
    writeCloudJson(JSON.stringify({ egressBase: FILE_BASE }));
    expect(readCloudDomainEgressBase(agentDir)).toBe(FILE_BASE);
  });

  it("保留未知字段不影响读取(与 ConfigCodec 语义一致)", () => {
    writeCloudJson(JSON.stringify({ egressBase: FILE_BASE, somethingElse: { a: 1 } }));
    expect(readCloudDomainEgressBase(agentDir)).toBe(FILE_BASE);
  });

  describe("一律降级为 undefined 且不抛(坏配置不该让应用起不来,Req 8.5)", () => {
    it("文件不存在", () => {
      expect(readCloudDomainEgressBase(agentDir)).toBeUndefined();
    });

    it("JSON 损坏", () => {
      writeCloudJson("{ not json");
      expect(readCloudDomainEgressBase(agentDir)).toBeUndefined();
    });

    it("字段缺失 / 类型不对 / 空串", () => {
      for (const body of [
        JSON.stringify({}),
        JSON.stringify({ egressBase: 42 }),
        JSON.stringify({ egressBase: "" }),
        JSON.stringify({ egressBase: "   " }),
        JSON.stringify([1, 2, 3]),
      ]) {
        writeCloudJson(body);
        expect(readCloudDomainEgressBase(agentDir)).toBeUndefined();
      }
    });

    it("agentDir 未给出 / 为空", () => {
      expect(readCloudDomainEgressBase(undefined)).toBeUndefined();
      expect(readCloudDomainEgressBase("   ")).toBeUndefined();
    });

    it("目录不可读(路径指向不存在的深层目录)", () => {
      expect(readCloudDomainEgressBase(join(agentDir, "nope", "deeper"))).toBeUndefined();
    });
  });
});

describe("resolveCloudLoginConfig — 优先级", () => {
  it("env 有值 → 用 env,忽略配置域(Req 8.4:不破坏既有命令行用法)", () => {
    const c = resolveCloudLoginConfig({ [CLOUD_LOGIN_EGRESS_BASE_ENV]: ENV_BASE }, FILE_BASE);
    expect(c?.egressBaseUrl).toBe(ENV_BASE);
  });

  it("env 为空串 → 视为未提供,回落配置域", () => {
    const c = resolveCloudLoginConfig({ [CLOUD_LOGIN_EGRESS_BASE_ENV]: "   " }, FILE_BASE);
    expect(c?.egressBaseUrl).toBe(FILE_BASE);
  });

  it("仅配置域有值 → 启用(这正是打包桌面版的路径,Req 8.3)", () => {
    const c = resolveCloudLoginConfig({}, FILE_BASE);
    expect(c?.egressBaseUrl).toBe(FILE_BASE);
  });

  it("两者皆无 → undefined,行为与本特性引入前一致(Req 8.5)", () => {
    expect(resolveCloudLoginConfig({}, undefined)).toBeUndefined();
    expect(resolveCloudLoginConfig({})).toBeUndefined();
  });

  it("配置域值非法 → 仍 fail-fast,不静默吞掉用户的错误配置(Req 8.6)", () => {
    expect(() => resolveCloudLoginConfig({}, "ftp://bad/x")).toThrow(CloudLoginConfigError);
    expect(() => resolveCloudLoginConfig({}, "not a url")).toThrow(CloudLoginConfigError);
  });

  it("端到端:写文件 → 读出 → 解析启用(打包态的真实链路)", () => {
    mkdirSync(agentDir, { recursive: true });
    writeCloudJson(JSON.stringify({ egressBase: FILE_BASE }));
    const c = resolveCloudLoginConfig({}, readCloudDomainEgressBase(agentDir));
    expect(c).toBeDefined();
    expect(c?.egressBaseUrl).toBe(FILE_BASE);
  });
});

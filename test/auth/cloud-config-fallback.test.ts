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
  readDesktopScopedCloudEgressBase,
  CloudLoginConfigError,
  CLOUD_LOGIN_EGRESS_BASE_ENV,
} from "@/lib/app/auth-egress-assembly";
import { DESKTOP_MARKER_ENV } from "@/lib/app/cloud-defaults";

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

/**
 * cloud.json 回落的**宿主作用域**(实测缺陷回归守卫,2026-07-30)。
 *
 * `<agentDir>` 默认 `~/.pi/agent/` 被桌面壳与 `pnpm dev` / npm CLI 共用 —— 桌面版登录写下的
 * cloud.json 曾让 dev 也启用云端登录,进而被登录页拦住(链路:配置启用 → identityProvider
 * 挂载 → `canExchange: true` → IdentityGate 拦)。
 */
describe("readDesktopScopedCloudEgressBase — 回落只对桌面壳生效", () => {
  beforeEach(() => {
    writeCloudJson(JSON.stringify({ egressBase: FILE_BASE }));
  });

  it("★ 非桌面宿主(dev / npm CLI:无桌面标记)→ 不回落,云端登录整体不启用", () => {
    expect(readDesktopScopedCloudEgressBase(agentDir, {})).toBeUndefined();
    // 装配处的真实表达式:回落为空 → 配置为 undefined → 无 identityProvider → 前端不拦。
    expect(
      resolveCloudLoginConfig({}, readDesktopScopedCloudEgressBase(agentDir, {})),
    ).toBeUndefined();
  });

  it("★ 判别力自证:同一份 cloud.json 在桌面壳下**必须**回落成功", () => {
    // 若这条与上一条同时为 undefined,说明门控写成了恒 false —— 上一条的绿灯就毫无意义。
    const env = { [DESKTOP_MARKER_ENV]: "1" };
    expect(readDesktopScopedCloudEgressBase(agentDir, env)).toBe(FILE_BASE);
    expect(resolveCloudLoginConfig({}, readDesktopScopedCloudEgressBase(agentDir, env))
      ?.egressBaseUrl).toBe(FILE_BASE);
  });

  it("标记存在但值不是 \"1\" → 不回落(标记语义严格)", () => {
    for (const v of ["", "0", "true", "yes"]) {
      expect(
        readDesktopScopedCloudEgressBase(agentDir, { [DESKTOP_MARKER_ENV]: v }),
      ).toBeUndefined();
    }
  });

  it("env 显式值仍对所有宿主有效(Req 8.4:不破坏 dev/CLI 显式接云端的用法)", () => {
    const c = resolveCloudLoginConfig(
      { [CLOUD_LOGIN_EGRESS_BASE_ENV]: ENV_BASE },
      readDesktopScopedCloudEgressBase(agentDir, {}),
    );
    expect(c?.egressBaseUrl).toBe(ENV_BASE);
  });

  it("桌面壳但文件不存在 → undefined(不因门控通过就凭空造值)", () => {
    rmSync(join(agentDir, "cloud.json"), { force: true });
    expect(
      readDesktopScopedCloudEgressBase(agentDir, { [DESKTOP_MARKER_ENV]: "1" }),
    ).toBeUndefined();
  });
});

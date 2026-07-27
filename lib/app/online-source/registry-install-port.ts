/**
 * registry-install-port(spec: desktop-online-source-runnable,任务 3.1)——
 * 把 P1 的桌面能力授予接到既有注册表安装实现上。
 *
 * ## 职责边界(重要)
 *
 * 本模块**只做编排**:取授予 → 构造消费面 adapter → 委托 `installFromRegistry` → 归一失败分类。
 * 下载、解包、sha384 完整性复核、失败回滚、原子落盘、写回执 **全部属既有实现**
 * (`server/cli/install/registry-install.ts`,归 spec `cli-package-commands`),本模块一行不重造。
 *
 * ## 为什么本文件在应用层而非 packages/server
 *
 * 它经 `server/cli/**` 间接依赖 `@pi-clouds/registry-client`,而 P1 的范围铁律要求该依赖
 * **不得进入 `packages/server/src`**。`lib/app/**` 与 `server/cli/**` 同属根应用层,故此处合法。
 * 与之配对的「判别 + 索引」则下沉在包内(纯 fs),两侧经本端口接口对接(依赖倒置)。
 *
 * ## 凭据卫生(Req 4.5 / 5.4)
 *
 * 授予令牌只交给 adapter 作 Authorization 用,**不写盘、不进日志、不进任何返回载荷**。
 * 失败归一时刻意丢弃底层 `detail` 中可能夹带的原始文本 —— 底层错误信息可能包含请求 URL
 * 或响应体,而那里有夹带令牌的风险。宁可少一点诊断信息,也不冒泄露风险。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { readInstalledReceipt } from "@blksails/pi-web-server";
import type { OnlineSourceRef } from "@blksails/pi-web-server";
import { HttpRegistryAdapter } from "@/server/cli/registry/http-registry-adapter";
import { installFromRegistry } from "@/server/cli/install/registry-install";
import type { RegistryPort } from "@/server/cli/registry/registry-port";

/** 安装失败的判别联合;调用方据 `code` 区分阶段并决定用户可见文案。 */
export type InstallFailure =
  | { readonly code: "NOT_AUTHENTICATED" }
  | { readonly code: "GRANT_UNAVAILABLE" }
  | { readonly code: "NOT_FOUND"; readonly sourceId: string; readonly channel: string }
  | { readonly code: "UNSUPPORTED_DISTRIBUTION"; readonly originType: string }
  | { readonly code: "DOWNLOAD_FAILED" }
  | { readonly code: "EXTRACT_FAILED" }
  | { readonly code: "INTEGRITY_MISMATCH" }
  | { readonly code: "TARGET_OCCUPIED"; readonly dir: string };

export type InstallOutcome =
  | { readonly ok: true; readonly dir: string }
  | { readonly ok: false; readonly failure: InstallFailure };

export interface RegistryInstallPort {
  install(ref: OnlineSourceRef): Promise<InstallOutcome>;
}

export interface SourcesGrant {
  readonly baseUrl: string;
  readonly token: string;
}

/** 测试注入点;生产不传。 */
export interface RegistryInstallPortDeps {
  readonly makeRegistry?: (opts: {
    readonly baseUrl: string;
    readonly consumeToken: string;
  }) => RegistryPort;
  readonly installImpl?: typeof installFromRegistry;
}

export interface RegistryInstallPortOptions {
  /** P1 的授予取得器;无授予/未登录 → undefined。 */
  readonly getSourcesGrant: () => Promise<SourcesGrant | undefined>;
  /** 安装落点根(= agent 源扫描根),使装完即被扫描枚举。 */
  readonly targetRoot: string;
  readonly deps?: RegistryInstallPortDeps;
}

/**
 * 由 sourceId 派生文件系统安全的目录名。
 *
 * 上游 `parseOnlineSourceRef` 已把 sourceId 限定为 `[A-Za-z0-9._-]` 加作为分隔的 `/`,
 * 故此处只需处理 `/`。仍做一次防御式兜底:任何非白名单字符一律替换,杜绝路径穿越。
 */
export function deriveInstallDirName(sourceId: string): string {
  return sourceId.replace(/\//g, "__").replace(/[^A-Za-z0-9._-]/g, "_");
}

/**
 * 从底层 `RESOLVE_FAILED.detail` 里判别「源不存在」。
 *
 * ⚠ 耦合点:`installFromRegistry` 把 `RegistryError` 经 `JSON.stringify` 塞进 `detail`
 * 字符串,故这里只能反解。两者同仓,形状稳定;但一旦上游改变该编码方式,本函数会**静默
 * 退化为"不是 NOT_FOUND"**(而非崩溃)—— 这是刻意选择的降级方向,并已登记为复验触发器。
 */
function isSourceAbsent(detail: unknown): boolean {
  if (typeof detail !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(detail);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { code?: unknown }).code === "SOURCE_ABSENT"
    );
  } catch {
    return false;
  }
}

export function createRegistryInstallPort(
  opts: RegistryInstallPortOptions,
): RegistryInstallPort {
  const makeRegistry =
    opts.deps?.makeRegistry ??
    ((o: { baseUrl: string; consumeToken: string }): RegistryPort =>
      new HttpRegistryAdapter({ baseUrl: o.baseUrl, consumeToken: o.consumeToken }));
  const installImpl = opts.deps?.installImpl ?? installFromRegistry;

  return {
    async install(ref: OnlineSourceRef): Promise<InstallOutcome> {
      const targetDir = join(opts.targetRoot, deriveInstallDirName(ref.sourceId));

      // 目标位置保护(Req 4.3):已存在但**不是本通道安装**(无回执)→ 明确失败,
      // 不静默覆盖用户手放的同名目录。已有本通道安装则允许重装(既有实现原子替换)。
      if (existsSync(targetDir) && readInstalledReceipt(targetDir) === undefined) {
        return { ok: false, failure: { code: "TARGET_OCCUPIED", dir: targetDir } };
      }

      // 授权前置(Req 5.1):无凭据即返回,**不构造 adapter、不发起任何网络请求**。
      let grant: SourcesGrant | undefined;
      try {
        grant = await opts.getSourcesGrant();
      } catch {
        return { ok: false, failure: { code: "GRANT_UNAVAILABLE" } };
      }
      if (grant === undefined) {
        return { ok: false, failure: { code: "NOT_AUTHENTICATED" } };
      }

      const registry = makeRegistry({ baseUrl: grant.baseUrl, consumeToken: grant.token });
      const result = await installImpl(registry, ref.sourceId, {
        channel: ref.channel,
        targetDir,
      });

      if (result.ok) return { ok: true, dir: targetDir };

      const e = result.error;
      switch (e.code) {
        case "RESOLVE_FAILED":
          return isSourceAbsent(e.detail)
            ? {
                ok: false,
                failure: { code: "NOT_FOUND", sourceId: ref.sourceId, channel: ref.channel },
              }
            : { ok: false, failure: { code: "GRANT_UNAVAILABLE" } };
        case "UNSUPPORTED_ORIGIN":
          return {
            ok: false,
            failure: { code: "UNSUPPORTED_DISTRIBUTION", originType: e.originType },
          };
        case "DOWNLOAD_FAILED":
          return { ok: false, failure: { code: "DOWNLOAD_FAILED" } };
        case "EXTRACT_FAILED":
          return { ok: false, failure: { code: "EXTRACT_FAILED" } };
        case "INTEGRITY_MISMATCH":
          return { ok: false, failure: { code: "INTEGRITY_MISMATCH" } };
      }
    },
  };
}

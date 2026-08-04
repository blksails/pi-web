/**
 * publish-execute(spec publish-execution)—— `/agent publish` / `/plugin publish`
 * **不带 `--dry-run`** 时的真实发布编排。
 *
 * ## 与 `publish-preview.ts` 的分工
 *
 * 预览:编译 → kind 门 → 组卡片。**零凭据、零外部写。**
 * 本模块:预览做的那些**全做**,再加四道前置,然后才动外部 —— 顺序本身是契约。
 *
 * ## 为什么前置校验这么重要(这不是防御性编程)
 *
 * registry 的 `registerVersion` 在失败时会**落一条 `failed` 记录**并占住该 `sourceId@version`。
 * 也就是说:一次本可以在本地拦下的失败,会**烧掉用户一个版本号** —— 他必须改版本号才能再试。
 * 而版本一经登记即不可删(DB 触发器强制),只能 yank。
 *
 * 所以本模块的原则是:**凡是本地能判定的,绝不拿一个版本号去换一条服务端错误。**
 *
 * 四道前置(全部在编译之后、任何外部写之前):
 *   ① kind 门 —— 命令名即意图,清单是权威;
 *   ② org 前缀 —— 包 id 的命名空间段必须等于授予里的 org(见下);
 *   ③ 本机密钥可用;
 *   ④ 本机公钥已登记 —— 没登记则服务端验签**必然**失败。
 *
 * ## ② 为什么在本地重复判一次 org
 *
 * 服务端那条判定(`autoCreateSourceBySignature` → `assertOrgMatchesCaller`)仍是**权威**,
 * 本地这条只为**可懂性**:服务端会抛 `ForbiddenError`,消息是"禁止访问",而真实原因是
 * "你的包 id 前缀写的不是你的命名空间"。用户拿着前者无从下手。
 * 二者漂移时以服务端为准 —— 本地判定放宽了不会造成越权(服务端还会拦),收紧了则是可见的拒绝。
 *
 * ## 凭据卫生
 *
 * 授予 `token` **只**传给 `HttpRegistryAdapter` 的构造函数,用作 Authorization 头。
 * 它不进结果数据、不进审计、不进日志、不落盘。`RegistryError.detail` **整体丢弃** ——
 * 它可能内嵌带凭据的 URL(既有裁断,见 registry-channel 的同类处理)。
 */
import type { PluginKind } from "@blksails/pi-web-protocol";
import type { PublishPreviewData } from "@blksails/pi-web-protocol";
import type { PublishGrant } from "@blksails/pi-web-adapters/auth/index.js";
import { compile, type CompiledPackage } from "../../server/cli/publish/manifest-compiler.js";
import {
  publish as runPublish,
  type PublishError,
  type PublishResult,
} from "../../server/cli/publish/publish-orchestrator.js";
import type { RegistryPort } from "../../server/cli/registry/registry-port.js";
import { HttpRegistryAdapter } from "../../server/cli/registry/http-registry-adapter.js";
import { ensurePublishKey, describeKeystoreError, type PublishKeyInfo, type KeystoreError } from "../../server/cli/publish/keystore.js";
import type { Result } from "../../server/cli/publish/manifest-compiler.js";
import { describeCompileError } from "./publish-preview.js";

/** 未指定时的发布通道。与 CLI 缺省一致。 */
export const DEFAULT_PUBLISH_CHANNEL = "stable";

/** 真实发布成功时两位皆 false —— 它不是预览。 */
const PUBLISHED_DISCLAIMERS = { unsigned: false, grantNotChecked: false } as const;
/** 真实发布**失败**时:签了名、也校验过授予,只是没成 —— 与预览的两位皆 true 不同。 */
const ATTEMPTED_DISCLAIMERS = { unsigned: false, grantNotChecked: false } as const;

export interface PublishExecuteDeps {
  readonly getPublishGrant: () => Promise<PublishGrant | undefined>;
  readonly ensureKey?: () => Result<PublishKeyInfo, KeystoreError>;
  /**
   * 硬前置:公钥必须已登记。返回 false → 拒绝发布。
   *
   * ⚠ 与 dry-run 路径的 best-effort **刻意不同**:没登记则服务端验签必然失败,
   * 而那次失败会烧掉一个版本号。
   */
  readonly ensureKeyRegistered: () => Promise<boolean>;
  /** 测试注入。 */
  readonly createPort?: (grant: PublishGrant) => RegistryPort;
  readonly publishFn?: typeof runPublish;
  readonly compileFn?: typeof compile;
}

export interface PublishExecuteInput {
  readonly packageDir: string;
  readonly expectedKind: PluginKind;
  readonly channel?: string;
}

export interface PublishExecuteOutcome {
  readonly data: PublishPreviewData;
  readonly message: string;
}

/** 包 id 的命名空间段(`org/name` → `org`)。 */
export function orgOf(sourceId: string): string {
  const i = sourceId.indexOf("/");
  return i <= 0 ? "" : sourceId.slice(0, i);
}

function failure(
  code: string,
  message: string,
  hint: string | undefined,
  disclaimers: PublishPreviewData["disclaimers"],
  pkg?: CompiledPackage,
): PublishExecuteOutcome {
  return {
    data: {
      ok: false,
      ...(pkg !== undefined
        ? {
            package: { id: pkg.id, version: pkg.version, kind: pkg.kind, displayName: pkg.displayName },
            files: pkg.refs.map((r) => ({ path: r.path, integrity: r.integrity })),
            warnings: [...pkg.warnings],
          }
        : { files: [], warnings: [] }),
      disclaimers,
      error: { code, message, ...(hint !== undefined ? { hint } : {}) },
    },
    message,
  };
}

/**
 * 执行真实发布。
 *
 * ★ 五道关卡的**顺序**是契约的一部分(测试据此断言 `createPort` 在拒绝路径下从未被调用)。
 */
export async function executePublish(
  input: PublishExecuteInput,
  deps: PublishExecuteDeps,
): Promise<PublishExecuteOutcome> {
  // ── 0. 发布授予。没有就走既有的诚实降级语义,**连编译都不做** ──
  const grant = await deps.getPublishGrant();
  if (grant === undefined) {
    const message = "该部署尚未接入发布身份,无法执行真正的发布。";
    return failure(
      "PUBLISH_NOT_AVAILABLE",
      message,
      "加 --dry-run 可做发布前预览(编译校验、文件清单与告警),不产生任何外部写。",
      { unsigned: true, grantNotChecked: true },
    );
  }

  // ── 1. 编译。纯本地,不构成外部写 ──
  const compileFn = deps.compileFn ?? compile;
  const compiled = await compileFn(input.packageDir);
  if (!compiled.ok) {
    const d = describeCompileError(compiled.error);
    return failure(d.code, d.message, d.hint, ATTEMPTED_DISCLAIMERS);
  }
  const pkg = compiled.value;

  // ── 2. kind 门。清单权威,与预览同一判定 ──
  if (pkg.kind !== input.expectedKind) {
    const alt = pkg.kind === "component" ? undefined : `/${pkg.kind} publish`;
    return failure(
      "PUBLISH_KIND_MISMATCH",
      `该包的发布清单声明类别是 "${pkg.kind}",而当前命令按 "${input.expectedKind}" 处理。`,
      alt !== undefined
        ? `请改用 ${alt}。`
        : "component 包不经 publish 车道分发;请在目标 source 目录内使用 `pi-web add` 安装组件包。",
      ATTEMPTED_DISCLAIMERS,
      pkg,
    );
  }

  // ── 3. org 前缀。本地判一次,只为给出可修复的说明(服务端那条仍是权威)──
  const org = orgOf(pkg.id);
  if (org !== grant.org) {
    return failure(
      "PUBLISH_ORG_MISMATCH",
      `包标识 "${pkg.id}" 的命名空间是 "${org || "(空)"}",而你的发布身份属于 "${grant.org}"。`,
      `请把发布清单里的 id 改成 "${grant.org}/<名称>"。命名空间由企业身份决定,不能自选。`,
      ATTEMPTED_DISCLAIMERS,
      pkg,
    );
  }

  // ── 4. 本机密钥 ──
  const keyRes = (deps.ensureKey ?? ensurePublishKey)();
  if (!keyRes.ok) {
    return failure(keyRes.error.code, describeKeystoreError(keyRes.error), undefined, ATTEMPTED_DISCLAIMERS, pkg);
  }

  // ── 5. 公钥已登记。硬前置:没登记则服务端验签必然失败,而那会烧掉一个版本号 ──
  if (!(await deps.ensureKeyRegistered())) {
    return failure(
      "PUBLISH_KEY_NOT_REGISTERED",
      "本机签名公钥尚未登记到你的发布者名下,发布会在验签阶段失败。",
      "通常稍后重试即可。若持续失败,可能是这把公钥已登记在其它发布者名下 —— 请联系管理员。",
      ATTEMPTED_DISCLAIMERS,
      pkg,
    );
  }

  // ── 6. 真正发布。此后每一步都可能产生外部写 ──
  const channel = input.channel ?? DEFAULT_PUBLISH_CHANNEL;
  const port = (deps.createPort ?? defaultCreatePort)(grant);
  const publishFn = deps.publishFn ?? runPublish;
  const res: PublishResult = await publishFn(port, {
    packageDir: input.packageDir,
    keyPath: keyRes.value.path,
    channel,
  });

  if (res.ok && res.value.kind === "published") {
    const v = res.value;
    return {
      data: {
        ok: true,
        package: { id: pkg.id, version: pkg.version, kind: pkg.kind, displayName: pkg.displayName },
        files: pkg.refs.map((r) => ({ path: r.path, integrity: r.integrity })),
        warnings: [...v.warnings],
        disclaimers: PUBLISHED_DISCLAIMERS,
        published: {
          sourceId: v.sourceId,
          version: v.version,
          bundle: v.bundle,
          channel,
          channelMoved: v.channelMoved,
          publisherId: grant.publisherId,
          org: grant.org,
        },
      },
      message: `已发布 ${v.sourceId}@${v.version}(通道 ${channel})。该版本不可更改,后续改动请提新版本号。`,
    };
  }

  if (res.ok) {
    // dry-run 形态不该出现在本路径(我们从不传 dryRun)。归一为可诊断的失败而非静默成功。
    return failure(
      "PUBLISH_UNEXPECTED",
      "发布返回了预演结果,但本次是真实发布。",
      undefined,
      ATTEMPTED_DISCLAIMERS,
      pkg,
    );
  }

  return mapPublishError(res.error, pkg, channel, grant);
}

/** 生产装配:授予 → HTTP adapter。token 只在这里出现一次。 */
function defaultCreatePort(grant: PublishGrant): RegistryPort {
  return new HttpRegistryAdapter({ baseUrl: grant.baseUrl, publishToken: grant.token });
}

/**
 * 阶段化失败映射。
 *
 * ★ 最要紧的是 `register` 与 `channel` 给出**相反**的重试指导:
 *   · 登记失败 → 版本号**已被占用**,必须提版本号;
 *   · 通道失败 → 版本已登记,**千万别**改版本号,重试只需移通道。
 *   把二者压成"发布失败"会让用户在这两条路上都走错。
 */
function mapPublishError(
  e: PublishError,
  pkg: CompiledPackage,
  channel: string,
  grant: PublishGrant,
): PublishExecuteOutcome {
  if (e.stage === "compile" || e.stage === "sign") {
    const d = describeCompileError(e.error);
    return failure(d.code, d.message, d.hint, ATTEMPTED_DISCLAIMERS, pkg);
  }

  if (e.stage === "channel") {
    // ★ 部分成功:版本已登记,只是通道没移。**不能**呈现为失败 ——
    //   呈现为失败会诱导用户改版本号重试,而那既没必要也解决不了问题。
    const r = e.registered;
    return {
      data: {
        ok: true,
        package: { id: pkg.id, version: pkg.version, kind: pkg.kind, displayName: pkg.displayName },
        files: pkg.refs.map((x) => ({ path: x.path, integrity: x.integrity })),
        warnings: [...pkg.warnings],
        disclaimers: PUBLISHED_DISCLAIMERS,
        published: {
          sourceId: r.sourceId,
          version: r.version,
          bundle: r.bundle,
          channel,
          channelMoved: false,
          publisherId: grant.publisherId,
          org: grant.org,
        },
      },
      message: `版本 ${r.sourceId}@${r.version} 已登记,但通道 ${channel} 未移过去(${e.error.code})。重试只需移通道,不要改版本号。`,
    };
  }

  // upload / register。★ 只用 code,**丢弃 detail** —— 它可能内嵌带凭据的 URL。
  if (e.stage === "upload") {
    return failure(
      "PUBLISH_UPLOAD_FAILED",
      `上传发布包失败(${e.error.code})。`,
      "版本号尚未被占用,修好后可用**同一版本号**重试。",
      ATTEMPTED_DISCLAIMERS,
      pkg,
    );
  }
  return failure(
    "PUBLISH_REGISTER_FAILED",
    `登记版本失败(${e.error.code})。`,
    `注册表已占用 ${pkg.id}@${pkg.version} 这个版本号,同一版本号无法再次登记 —— 请提版本号后重试。`,
    ATTEMPTED_DISCLAIMERS,
    pkg,
  );
}

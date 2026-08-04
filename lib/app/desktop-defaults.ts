/**
 * 桌面形态的功能默认值与取值裁决(spec desktop-runtime-config)。
 *
 * ## 解决什么
 *
 * 功能门控此前只能来自进程环境变量,而打包的桌面版拿不到 —— Finder / `open` 启动的 GUI
 * 应用不继承 shell 环境,也不读仓库的 `.env.local`。桌面版遂恒定运行在「全部增强功能关闭」
 * 的形态。真机实测:桌面版 `/api/bootstrap` 下发 `sourcePicker=false`,同机 dev 为 `true`。
 *
 * 该缺口在开发中完全不可见 —— `pnpm dev:desktop` 会加载 `.env.local`,开发路径恰好绕开。
 *
 * ## 三级优先级(与 `cloud-defaults.ts` 同一约定)
 *
 *     env 显式值  >  用户配置(desktop 域)  >  桌面默认值
 *
 * 桌面默认值处于**最低**一级:它只是「用户还没表过态时的起点」,压不过运维显式给的环境变量,
 * 也盖不住用户在设置面板里改过的值 —— 否则改了保存也没用,而那种失效是静默的。
 *
 * ## ★ 只对桌面壳生效
 *
 * 判据是壳自述的 {@link DESKTOP_MARKER_ENV}(壳在拉起后端时写入)。`dist/` 载荷同时随
 * npm 包与 `.app` 分发,若无条件生效,每个 `pnpm dev` / npm CLI 用户都会被动改变行为。
 *
 * ## ★ 两个门控的 env 语义是相反的,不可统一处理
 *
 * - `NEXT_PUBLIC_PI_WEB_SOURCE_PICKER` 是**白名单**:只有 `"1"`/`"true"` 才开,未设 → 关。
 * - `PI_WEB_EXT_REQUIRE_SIGNATURE` 是**黑名单**:只有 `"false"` 才关,未设 → 开。
 *
 * 把它们写成同一套解析会让其中一个的默认值悄悄翻转。此处逐个保持既有语义,
 * 并由单测断言「非桌面形态 + 无配置」时返回值与本特性引入前**逐字段相等**。
 */
import { readFileSync } from "node:fs";
import { join as joinPath } from "node:path";
import { DESKTOP_MARKER_ENV } from "@blksails/pi-web-adapters/auth/index.js";
import type { DesktopConfig } from "@blksails/pi-web-protocol";

export { DESKTOP_MARKER_ENV };

export interface DesktopConfigInput {
  /** 运行时环境(装配处传 `process.env`;测试注入)。 */
  readonly env: NodeJS.ProcessEnv;
  /** 已读出的 desktop 域配置;缺失/损坏时传 `undefined`。 */
  readonly userConfig: DesktopConfig | undefined;
}

export interface ResolvedDesktopConfig {
  readonly sourcePicker: boolean;
  /**
   * 签名门控的**基础**取值。
   *
   * ★ 这不是最终判定:放行还需「来源是本机文件系统路径」这一条(见
   *   `web-ext-gate-config.ts`)。桌面形态下本值为 `false` 仅表示「不因缺签名而一律拒绝」,
   *   registry 装取的扩展仍会因来源条件不满足而继续验签。
   */
  readonly requireWebextSignature: boolean;
  /** 扫描根;`undefined` 表示用既有默认位置。 */
  readonly sourcesRoot: string | undefined;
}

/** 桌面壳形态判据。与 `cloud-defaults.ts` 用同一个标记,不另造。 */
export function isDesktopHost(env: NodeJS.ProcessEnv): boolean {
  return env[DESKTOP_MARKER_ENV] === "1";
}

/** env 是否**显式**表过态(键存在且非空白)。空串视为未表态,与「未设置」等价。 */
function explicit(v: string | undefined): boolean {
  return v !== undefined && v.trim().length > 0;
}

export function resolveDesktopConfig(input: DesktopConfigInput): ResolvedDesktopConfig {
  const { env, userConfig } = input;
  const desktop = isDesktopHost(env);

  // ── sourcePicker:白名单语义(只有 "1"/"true" 才开),既有默认为关 ──────────────
  const pickerEnv = env.NEXT_PUBLIC_PI_WEB_SOURCE_PICKER;
  const sourcePicker = explicit(pickerEnv)
    ? pickerEnv === "1" || pickerEnv === "true"
    : (userConfig?.sourcePicker ?? desktop);

  // ── requireWebextSignature:黑名单语义(只有 "false" 才关),既有默认为开 ────────
  const sigEnv = env.PI_WEB_EXT_REQUIRE_SIGNATURE;
  const requireWebextSignature = explicit(sigEnv)
    ? sigEnv !== "false"
    : (userConfig?.requireWebextSignature ?? !desktop);

  const rootRaw = userConfig?.sourcesRoot?.trim();
  const sourcesRoot = rootRaw !== undefined && rootRaw.length > 0 ? rootRaw : undefined;

  return { sourcePicker, requireWebextSignature, sourcesRoot };
}

/**
 * 读 `<agentDir>/desktop.json`,**但仅在桌面壳宿主下生效**。
 *
 * ## ★ 为什么读取本身也要限定桌面壳
 *
 * `<agentDir>` 默认是 `~/.pi/agent/` —— 桌面壳、`pnpm dev`、npm CLI **共用同一个目录**。
 * 若无条件读取,桌面用户在设置面板里关掉某个门控,此后每一次 `pnpm dev` 与每一条 npm CLI
 * 调用都会跟着关掉 —— 而他们既没表过态,也不知道这个文件的存在。那会直接违反
 * 「非桌面形态行为与本特性引入前逐字段一致」(Req 4.2)。
 *
 * 这不是假想:`cloud` 域踩过同一个坑并留下了记录 —— 桌面版登录一次写下 `cloud.json`,
 * 之后每次 `pnpm dev` 都被拦在一块登不进去的登录页前(见 `auth-egress-assembly.ts`
 * 的 `readDesktopScopedCloudEgressBase` 注释)。本函数照该先例处理。
 *
 * ## 优先级不变
 *
 * env 显式值对**所有宿主**有效;本门控只约束「未表态时的隐式回落」。
 *
 * ## 容错
 *
 * 文件不存在 / 不可读 / JSON 损坏 / 顶层非对象 → 一律 `undefined`,**绝不抛出**(Req 3.2)。
 * 配置坏掉不该让应用起不来,降级回桌面默认值即可。字段级的类型不符由裁决函数按
 * `?? 默认` 自然处理,不在此做 schema 校验(那是配置端点 PUT 时的职责)。
 *
 * ## 为什么同步读
 *
 * 与 `readCloudDomainEgressBase` 同一考量:装配期读一次,文件极小,开销可忽略;
 * 为一次读取把整条装配链改成异步不划算。
 */
export function readDesktopScopedConfig(
  agentDir: string | undefined,
  env: NodeJS.ProcessEnv,
): DesktopConfig | undefined {
  if (!isDesktopHost(env)) return undefined;
  if (agentDir === undefined || agentDir.trim().length === 0) return undefined;
  let raw: string;
  try {
    raw = readFileSync(joinPath(agentDir, "desktop.json"), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null) return undefined;
  return parsed as DesktopConfig;
}

/**
 * 宿主 `@blksails/pi-web-kit` 版本的**唯一解析点**(#33)。
 *
 * 该值是 webext 兼容判定的输入(`packages/react/src/web-ext/extension-gate.ts` 的
 * `isApiCompatible`),决定一个扩展能否被加载。
 *
 * ## 为什么要收敛到一处
 *
 * 修复前存在**两条独立链路、两个不同的 env 名**,且各自硬编码兜底 `"0.1.0"`:
 *
 *   - `server/bootstrap.ts` → `GET /api/bootstrap` → 前端 runtime features
 *     读 `NEXT_PUBLIC_PI_WEB_KIT_VERSION`
 *   - `lib/app/web-ext-gate-config.ts` → `GateOptions` → `verifyExtension`(**真正做判定的**)
 *     读 `PI_WEB_KIT_VERSION`
 *
 * 设一个不设另一个,两条链路就会给出不同的宿主版本。而包实际版本早已是 0.5.0,
 * 两处却都自称 0.1.0 —— 这正是 #33:**「填对版本」与「填错版本」的后果相反**
 * (不设则按真实版本构建的扩展被拒;一旦设成真实版本,所有存量 `^0.1.0` 扩展全被拒)。
 *
 * ## 现在的语义
 *
 * 版本**来自包本身**(构建期从 `packages/web-kit/package.json` 内联为
 * `__PI_WEB_KIT_VERSION__`,唯一读取点 `scripts/web-kit-version.mjs`),env 降级为
 * **可选覆盖**。两个历史 env 名都继续认,避免破坏既有部署。
 */

/**
 * 构建期注入的 web-kit 真实版本。由四条构建路径的 `define` 提供:
 * `scripts/build-server.mjs` / `vite.config.ts` / `vitest.config.ts` /
 * `vitest.node-e2e.config.ts`。
 */
declare const __PI_WEB_KIT_VERSION__: string | undefined;

/** 历史 env 名(按优先级)。两者都认:曾各自服务于一条链路,不能只留一个。 */
const OVERRIDE_ENV_KEYS = ["NEXT_PUBLIC_PI_WEB_KIT_VERSION", "PI_WEB_KIT_VERSION"] as const;

/**
 * 解析宿主自述的 web-kit 版本:env 覆盖 → 构建期注入值。
 *
 * 注入缺失时**显式抛错**而非回落到硬编码版本 —— 静默错值正是本缺陷的成因,
 * 且它的症状(扩展莫名被拒)与原因(版本脱节)相距很远,极难排查。
 */
export function resolveHostApiVersion(env: NodeJS.ProcessEnv = process.env): string {
  for (const key of OVERRIDE_ENV_KEYS) {
    const v = env[key];
    if (v !== undefined && v.trim() !== "") return v;
  }
  if (typeof __PI_WEB_KIT_VERSION__ !== "string" || __PI_WEB_KIT_VERSION__ === "") {
    throw new Error(
      "[host-api-version] 宿主 web-kit 版本未注入:请检查各构建配置的 __PI_WEB_KIT_VERSION__ define(scripts/web-kit-version.mjs)",
    );
  }
  return __PI_WEB_KIT_VERSION__;
}

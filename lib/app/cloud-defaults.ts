/**
 * 随包固化的云端默认接入地址(spec: desktop-account-login,Req 11)。
 *
 * 目的:桌面版**装完即可登录**,不必让用户先去设置里手填云端地址 —— 而在这之前,
 * 一个全新安装的桌面版打开是没有登录入口的(`/api/auth/me` 404),用户无从下手。
 *
 * ## ★ 三条约束,少一条都会出事
 *
 * 1. **最低优先级**。次序是 `env 显式值 > 用户 <agentDir>/cloud.json > 本默认值`。
 *    固化值只是「用户还没表过态时的起点」,绝不能盖掉用户在设置面板里改过的地址 ——
 *    否则改了保存也没用,而那种失效是静默的。
 *
 * 2. **只对桌面壳生效**(判据 {@link DESKTOP_MARKER_ENV})。`dist/` 载荷同时随 npm 包
 *    与 `.app` 分发,若无条件生效,每个 `pnpm dev` / npm CLI 用户开机就会撞上登录门禁
 *    ——「能登录且未登录」即拦,而他根本没有这个云端的账号。把本地用法整个废掉。
 *    标记由桌面壳在 `build_child_env` 里写入:只有壳知道自己是壳。
 *
 * 3. **可被构建期覆盖**({@link BAKED_CLOUD_EGRESS_BASE_ENV})。私有化部署要出自己的
 *    桌面包,不该逼他们改源码;留一个构建期入口,值随 esbuild 进 `dist/server.mjs`。
 */

// 单一事实源在 server 包(壳凭据端点也要用它);此处 import + 重导出,不另写一份字符串。
import { DESKTOP_MARKER_ENV } from "@blksails/pi-web-adapters/auth/index.js";
export { DESKTOP_MARKER_ENV };

/** 构建期覆盖固化默认值用的 env 键(读取发生在打包时,不是运行时)。 */
export const BAKED_CLOUD_EGRESS_BASE_ENV = "PI_WEB_BAKED_CLOUD_EGRESS_BASE";

/**
 * 编译进产物的默认云端出口地址。
 *
 * 取值在**打包那一刻**确定:`process.env` 在此处求值一次,经 esbuild 常量折叠后
 * 成为 `dist/server.mjs` 里的字面量。运行时改这个环境变量不会有任何效果 ——
 * 运行时的覆盖入口是 `PI_WEB_CLOUD_LOGIN_EGRESS_BASE` 与设置面板。
 */
export const BAKED_CLOUD_EGRESS_BASE: string =
  process.env[BAKED_CLOUD_EGRESS_BASE_ENV]?.trim() ??
  "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1";

/**
 * 取本次运行适用的固化默认值。
 *
 * @param env 运行时环境(装配处传 `process.env`;测试注入)。
 * @returns 桌面壳下 → 固化地址;其他宿主(npm CLI / dev / 浏览器)→ `undefined`,
 *          行为与本特性引入前**完全一致**。
 */
export function resolveBakedCloudEgressBase(env: NodeJS.ProcessEnv): string | undefined {
  if (env[DESKTOP_MARKER_ENV] !== "1") return undefined;
  const v = BAKED_CLOUD_EGRESS_BASE.trim();
  return v.length > 0 ? v : undefined;
}

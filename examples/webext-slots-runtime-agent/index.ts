/**
 * webext-slots-runtime-agent — 第三方 slots 源本地全链 e2e 夹具(任务 6.4)。
 *
 * 与 `webext-slots-agent`(构建期静态 import 车道,`lib/app/webext-registry.ts` 已登记)
 * 内容同构(同一份 18 槽 fixture),但**刻意不在构建期注册表**、source 路径也不含
 * "webext-slots-agent" 子串,故不会被 `resolveExtensionForSource` 的 `includes` 命中。
 * 其 `.pi/web` 经 `pi-web build` 预构建为签名 .mjs(react/web-kit external),只能经
 * 运行时车道生效:/api/webext/resolve(服务端验签)→ import map(单例)→ import(.mjs)→
 * loadExtension → SlotHost。
 */
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  systemPrompt:
    "You are webext-slots-runtime-agent. Your UI fills all reserved host region slots via the runtime code-extension lane.",
});

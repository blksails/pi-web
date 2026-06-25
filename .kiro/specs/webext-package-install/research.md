# Research Log — webext-package-install

## 发现范围
扩展型特性（在既有系统上接线）。代码侧发现在对话中已完成，本日志固化结论与综合决策，供 design 自包含引用。

## 关键发现（事实，附位置）

| 主题 | 结论 | 位置 |
|---|---|---|
| 加载器 | `loadExtension()` 已实现：纯声明走零 bundle 分支，代码扩展走 fetch→gate→dynamic import；返回 `LoadOutcome`（loaded/declarative/skipped/rejected）。`browserLoaderDeps()` 用 `new Function` 绕打包器；`buildImportMap()` 备好 import map 生成。 | `packages/react/src/web-ext/extension-loader.ts:43-104` |
| 安全门 | `verifyExtension()` 串校验版本→SRI→签名。SRI=sha384（`crypto.subtle`，无需密钥）；签名=**HMAC-SHA256（对称）**，白名单为共享密钥；纯声明跳过 SRI/签名。 | `packages/react/src/web-ext/extension-gate.ts:42-158` |
| manifest 契约 | `WebExtensionManifestSchema`：id/targetApiVersion/entry?/css?/integrity?/signature?/capabilities?/config?。`entry` 存在则 `integrity` 必填（zod superRefine）。`canonicalManifestBytes` 排除 signature、固定 key 序。`isDeclarativeOnly = entry===undefined`。 | `packages/protocol/src/web-ext/manifest.ts` |
| 构建侧 | `pi-web build` 产 `computeIntegrity`（sha384）+ 可选 `signManifest`（HMAC）。 | `packages/web-kit/build/manifest-emit.ts` |
| 门控配置 | `buildGateOptionsFromEnv` 读 `PI_WEB_EXT_WHITELIST`/`PI_WEB_EXT_REQUIRE_SIGNATURE`(默认 true)/`PI_WEB_KIT_VERSION`(默认 0.1.0)。注释称「随页面下发客户端」。 | `lib/app/web-ext-gate-config.ts` |
| 当前加载车道 | 仅「构建期集成」接到 app-shell：静态 import `.pi/web/web.config` 按 source 匹配（`resolveExtensionForSource`）。运行时 import map 车道**基础设施已建但无宿主调用点**。 | `lib/app/webext-registry.ts`；`components/chat-app.tsx:353-357,498,517` |
| source 解析 | session→source 旁路映射（resume 重解析用），文件 `~/.pi/agent/piweb-session-sources/<id>`。 | `lib/app/session-source-map.ts` |
| 落盘位置 | pi install → npm 包 `~/.pi/agent/npm/node_modules/<pkg>/`（project: `<cwd>/.pi/npm/...`）；git → `.../git/`。`.pi/web` 非 pi 资源类型但文件随包落盘。`getInstalledPath(source, scope)` 可取已装路径。 | pi `DefaultPackageManager`（`@earendil-works/pi-coding-agent`）|

## 综合决策（build-vs-adopt / 简化）

1. **复用，不重写**：`loadExtension`/`extension-gate`(SRI)/`buildImportMap`/`applyExtension`/`session-source-map`/pi install 全部复用。本特性=接线 + 信任模型补强。
2. **签名改非对称（Ed25519）**：现有 HMAC 对称密钥无法满足「验签机密不入浏览器」(R5.2) 且「中心列表分发公钥」(R7.3)。决定把 `signManifest`/`verifySignature` 迁移到 Ed25519（`crypto.subtle` 支持），白名单/中心列表存**公钥**。
3. **验签拆分：服务端验签名 / 浏览器验 SRI**：服务端用公钥验 manifest 签名，通过后产出「已背书 manifest」(去 signature 字段或标记 `signaturePreVerified`)交浏览器；浏览器仅 SRI（无密钥）。gate 增 `signaturePreVerified` 选项跳过签名分支（SRI 仍执行）。
4. **中心可信发布者列表三级链**：出厂钉死根公钥 → 验中心列表(根私钥签) → 列表含发布者公钥 → 验扩展签名。中心列表**服务端消费**（喂白名单），故根验证也在服务端。fail-safe 回退出厂快照，绝不 fail-open。
5. **单例 ESM 供给**：import map 需把 `react`/`react-dom`/`@blksails/pi-web-kit` 映到宿主单例 ESM URL——新增「单例 ESM 提供」接缝（稳定 URL 暴露单例模块）+ `<head>` 注入 import map。
6. **分波**：Tier5 纯声明先行（零 crypto、零 import map）；Tier1-4 代码后做（Ed25519 迁移 + 服务端验签 + 中心列表 + import map + 单例供给）。

## 风险
- CSP：动态 `import()`/`new Function` 在禁 `unsafe-eval` 的生产 CSP 下可能失效 → 需 nonce 或确认行为（R3.4 已要求安全回退）。
- import map 单张限制：浏览器仅允许首个模块加载前存在一张 import map，注入必须早于任何 ESM。
- Ed25519 迁移影响 `manifest-emit` 与既有已签 examples，需同步重签。

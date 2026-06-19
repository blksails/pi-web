# Design Document

## Overview
本特性在既有 `schema-config-ui`(zod→FormSchema→SchemaForm 配置 UI 栈)之上,新增/完善「沙箱」与
「扩展」两个配置域,覆盖全局(`~/.pi/agent/*.json`)与项目(`<cwd>/.pi/*.json`)作用域;并在设置外壳
引入「同 group 面板 → 一个菜单项 + 全局/项目 Tab」的分组布局。沙箱 enforcement 由已安装的 pi-sandbox
扩展承担;主进程在两种 spawn 模式**强制注入**该扩展使其不依赖默认发现。可见性隔离由严格
`allowRead:["."]` 天然达成。

大部分已实现;本设计同时**追认已落地实现**并定义**剩余工作**(扩展配置域 + 整体 e2e)。

### Goals
- 沙箱/扩展配置可经设置页 schema 表单读写,全局 + 项目两作用域。
- 沙箱 enforcement 强制注入,不依赖 pi 默认扩展发现。
- 同类配置以一个菜单 + Tab 呈现。
- 扩展配置:固定 Slash 命令 allow/deny + per-扩展 KV,且与 `settings.json` 顶层结构正确互映。
- node + browser e2e 覆盖关键链路。

### Non-Goals
- 扩展安装/卸载(既有 `extension-management`)。
- 前端 chat 实际按「命令可用性」过滤命令面板(仅负责写设置)。
- 沙箱运行时交互授权 UI 的重写。

## Boundary Commitments

### This Spec Owns
- 协议:`config/domains/sandbox.ts`、`config/domains/extensions.ts` 及其在 `config/index.ts` 的注册。
- 服务:`config-routes.ts` 的 `sandbox` 域登记;`sandbox-project-routes.ts`;新增 `extensions-config-routes.ts`;`sandbox/entry.ts`(强制注入入口解析);`runner/option-mapper.ts` 的 `forcedExtensionPaths` 注入。
- 前端:`field-renderer` 新控件(boolean/stringList/object/`extensionsKv`);`settings-shell` 分组 Tab;`settings-registry` 分组字段;`lib/settings/register-panels.ts` 面板登记。
- e2e:node(`e2e/node/*`)+ browser(`e2e/browser/*`)。

### Out of Boundary
- pi-sandbox 扩展本体与 `@carderne/sandbox-runtime`(外部 npm,user-scope 安装)。
- pi SDK 扩展加载器/资源加载器内部实现。
- `extension-management` 的安装/卸载路由。

### Allowed Dependencies
- `@pi-web/protocol`(FormSchema/zodToFormSchema/secret 契约)、`@pi-web/server`(http/config/runner)、
  `@pi-web/react`(settings-registry/use-config-domain)、`@pi-web/ui`(SchemaForm/field-registry)。
- pi SDK `@earendil-works/pi-coding-agent`(扩展加载语义:`-e`、`additionalExtensionPaths`、`extensionsOverride`)。

### Revalidation Triggers
- pi-sandbox 配置文件路径/合并语义变化。
- pi SDK 扩展加载或 `extensionsOverride` 语义变化。
- pi `settings.json` 中 per-扩展 KV / `commands` 表达方式变化。

## Architecture

### Existing Architecture Analysis
- 配置 UI 栈(`schema-config-ui`):`zodToFormSchema(domain, zodSchema, {groups})` → `FormSchema` IR →
  `SchemaForm` + `FieldRenderer`(按 widget/kind 分派)→ `useConfigDomain` 经 `GET·PUT /api/config/:domain` 读写;
  `SettingsShell` 读 `settings-registry` 渲染左导航 + 面板。
- 配置落盘:`ConfigCodec` 读写 `<PI_WEB_AGENT_DIR>/<domain>.json`,深合并保留未知键;
  `config-routes` 做 `maskSecrets`/`mergeSecrets` + 域 zod 校验。
- 会话装配:`pi-handler.createChannel` 按 `resolved.mode`(cli|custom)拼 spawnSpec;custom 由 runner
  `buildRuntimeFactory` → `createAgentSessionServices({resourceLoaderOptions})`。

### Architecture Pattern & Boundary Map
- 模式:既有「域注册 + 通用端点 + 通用渲染器」的可扩展配置中心 + 「按源注入」的会话装配。
- 边界:协议定义域 schema/IR;服务持久化与映射;前端注册面板与控件;runner 注入扩展。各层经包公共面交互。

### Technology Stack
- TypeScript / zod 3 / React 19 / Next 15 / Tailwind;测试 vitest(node)+ Playwright(browser)。
- 复用既有 `field-registry`(按 widget key 解析)实现自定义 `extensionsKv` 控件。

## File Structure Plan

### 已实现(本设计追认)
- `packages/protocol/src/config/domains/sandbox.ts` — 沙箱域 zod + FormSchema。
- `packages/protocol/src/config/index.ts` — 注册 `sandbox`(及后续 `extensions`)。
- `packages/server/src/config/config-routes.ts` — `DOMAIN_SCHEMAS.sandbox`。
- `packages/server/src/config/sandbox-project-routes.ts` — `/config/sandbox/project`。
- `packages/server/src/sandbox/entry.ts` — `resolveSandboxEntry`。
- `packages/server/src/runner/option-mapper.ts` — `forcedExtensionPaths` 注入 + 白名单豁免。
- `lib/app/pi-handler.ts` — 解析入口 + cli `-e` + custom env + 注入 sandbox-project 路由。
- `packages/ui/src/config/fields/{boolean,string-list,object}-field.tsx` + `field-renderer.tsx` 注册。
- `packages/ui/src/config/settings-shell.tsx` — 分组 Tab。
- `packages/react/src/config/settings-registry.ts` — 分组字段(group/groupTitle/groupOrder/tabLabel/tabOrder)。
- `lib/settings/register-panels.ts` — 沙箱全局/项目面板同组。

### 新建(剩余工作)
- `packages/protocol/src/config/domains/extensions.ts` — 扩展域 zod(`commands` + `extensions` KV)+ FormSchema。**(已写初稿)**
- `packages/server/src/config/extensions-config-routes.ts` — `GET·PUT /config/extensions[/project]`,
  做 `settings.json` ↔ 表单(`commands` + 顶层 per-扩展 KV)互映。
- `packages/ui/src/config/fields/extensions-kv-field.tsx` — 两级动态 KV 控件,注册到 field-registry。
- `e2e/node/config-domains.e2e.test.ts` — 沙箱/扩展端点 + option-mapper e2e。
- `e2e/browser/settings-config.e2e.ts` — 设置页 Tab 切换 + 保存。

### Modified Files
- `packages/protocol/src/config/index.ts` — 加 `extensions` 域。
- `packages/server/src/config/index.ts` — 导出 `createExtensionsConfigRoutes`。
- `lib/app/pi-handler.ts` — 注入 extensions 配置路由。
- `lib/settings/register-panels.ts` — 注册「扩展」分组(全局/项目)+ 注册 `extensionsKv` 控件。
- `packages/ui/src/config/index.ts` — 导出新控件(可选)。

## System Flows

**沙箱/扩展配置读写**:
```
设置页 → useConfigDomain → GET/PUT /api/config/<domain>[/project?cwd]
  → handler 注入路由 → 校验(zod)→ 互映(extensions: settings.json 顶层 ↔ 表单)→ 落盘
```

**强制注入**:
```
createChannel: resolveSandboxEntry(agentDir)
  ├ cli:   args += ["-e", entry]
  └ custom:env.PI_WEB_SANDBOX_ENTRY=entry
            → runner buildRuntimeFactory → mapResourceLoaderOptions(def,{forcedExtensionPaths:[entry]})
              → additionalExtensionPaths 置前 + extensionsOverride 豁免 basename
```

## Requirements Traceability
| 需求 | 组件 |
|---|---|
| 1.1–1.4 沙箱全局 | `domains/sandbox.ts`、`config-routes.DOMAIN_SCHEMAS.sandbox` |
| 2.1–2.5 沙箱项目 | `sandbox-project-routes.ts` |
| 3.1–3.5 强制注入 | `sandbox/entry.ts`、`pi-handler.createChannel`、`option-mapper` |
| 4.1–4.4 可见性隔离 | 严格 `~/.pi/agent/sandbox.json`(`allowRead:["."]`)+ 文档 |
| 5.1–5.4 Tab 布局 | `settings-registry`(分组字段)、`settings-shell`(buildGroups + tabs) |
| 6.1–6.4 命令可用性 | `domains/extensions.ts`(`commands`)、`extensions-config-routes` |
| 7.1–7.6 per-扩展 KV | `domains/extensions.ts`(`extensions`)、`extensions-kv-field`、`extensions-config-routes` 互映 |
| 8.1–8.5 e2e | `e2e/node/config-domains.e2e.test.ts`、`e2e/browser/settings-config.e2e.ts` |

## Components and Interfaces

### 协议 / 扩展配置域
#### extensionsConfigSchema (`domains/extensions.ts`)
```ts
commands?: { allow?: string[]; deny?: string[] }     // 固定区,group "commands"
extensions?: Record<string, Record<string,string>>   // KV 区,group "ext",widget "extensionsKv"
// passthrough,全可选
```

### 服务 / 扩展配置路由
#### createExtensionsConfigRoutes(opts)
- 路由:`GET·PUT /config/extensions`(全局,`<agentDir>/settings.json`)、`GET·PUT /config/extensions/project[?cwd]`(项目,`<cwd>/.pi/settings.json`)。
- 互映(纯函数,便于单测):
  - `settingsToForm(settings) → { commands, extensions }`:`commands = settings.commands ?? {}`;
    `extensions = { 各非保留且值为对象的顶层键 }`。保留键集:`{lastChangelogVersion, packages, defaultProvider, defaultModel, defaultThinkingLevel, theme, commands, frontend}`。
  - `applyFormToSettings(settings, form) → settings'`:写 `commands`;对每个 `form.extensions[k]` 用其 KV **整体替换** `settings[k]`(支持组内删键);保留其它键(非破坏)。
- 校验 `extensionsConfigSchema`;非法 422;项目 `cwd` 越界 403(复用 sandbox-project 的根校验)。

### 前端 / extensionsKv 控件
#### ExtensionsKvField (`fields/extensions-kv-field.tsx`)
- props 同 `FieldProps`;value 为 `Record<string, Record<string,string>>`。
- 两级增删:外层「扩展条目」(key=extId)、内层「键值对」。空值视为 `{}`。
- 经 `registerFieldRendererByKey("extensionsKv", ExtensionsKvField)` 注册(在 app 端调用)。

### 前端 / 分组 Tab(已实现,追认)
- `SettingsPanelDescriptor` 增 `group/groupTitle/groupOrder/tabLabel/tabOrder`。
- `SettingsShell.buildGroups` 聚合;>1 面板渲染 `role="tablist"`。

## Data Models

### Domain Model
- 沙箱配置:`{ enabled?, network?{allowedDomains?,deniedDomains?}, filesystem?{allowRead?,allowWrite?,denyRead?,denyWrite?} }`。
- 扩展配置(表单视图):`{ commands?{allow?,deny?}, extensions?{[extId]:{[k]:string}} }`。

### Physical Data Model
- 沙箱:`<agentDir>/sandbox.json`(全局)、`<cwd>/.pi/sandbox.json`(项目)。
- 扩展:`<agentDir>/settings.json`(全局)、`<cwd>/.pi/settings.json`(项目)——
  `commands` 为命名键;per-扩展 KV 为**顶层** `<extId>` 键(与 pi 读取一致)。

### Data Contracts & Integration
- 扩展配置 PUT 必须**非破坏**保留 `settings.json` 既有键(`packages`/provider/theme 等),仅更新表单覆盖到的键。

## Error Handling
### Error Strategy
- 校验失败 → 422(字段路径);`cwd` 越界 → 403;非法 JSON → 400;未知域 → 404。
### Error Categories and Responses
- 写盘失败 → 500(不泄敏)。互映保留键缺失视为非破坏(只增改不删未知键)。

## Testing Strategy
### Unit / Integration(vitest, packages/server)
- 扩展互映纯函数:`settingsToForm`/`applyFormToSettings`(保留键不丢、顶层 KV 往返、组内删键)。
- 扩展路由:GET/PUT 全局 + 项目往返、422、403(对应 6.1–6.4 / 7.1–7.6)。
- option-mapper 强制注入(已有 `option-mapper-forced-inject.test.ts`,对应 3.x)。
### node e2e(`e2e/node/config-domains.e2e.test.ts`)
- 起 handler,验证 `/config/sandbox`、`/config/sandbox/project`、`/config/extensions[/project]` 端到端读写 + 校验(8.1/8.2)。
- 验证强制注入装配(8.3)。
- 使用临时 `PI_WEB_AGENT_DIR` 与临时 cwd,不污染用户级 `~/.pi/agent`(8.5)。
### browser e2e(`e2e/browser/settings-config.e2e.ts`, Playwright)
- 打开 `/settings`,验证「沙箱」「扩展」各为一个菜单项;切换全局/项目 Tab;改值保存并回读(8.4)。
- 复用既有隔离 build(`NEXT_DIST_DIR=.next-e2e` + external server),不污染共享 `.next`(8.5)。

## Supporting References
- `docs/pi-sandbox-integration-research.md`(§10–12 已落地记录)。
- 既有 spec:`schema-config-ui`、`extension-management`、`slash-command-palette`。

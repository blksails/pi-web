# Design Document — source-settings-and-slots

## Overview

本 spec 一次性固化「agent-source 扩展性七面」收尾两项:**面⑦ per-source settings** 与 **面⑤ 第三方 slots 的 webext 云上支持**。两项各自独立,但共享三条地基(稳定 sourceKey、raw-line 侧路通道、agent-declared-routes 数据端点)。

- **面⑦**:agent-source 作者在清单声明 FormSchema,宿主设置外壳零改动动态长出面板,值持久化到 per-source 命名空间,runner 装配期消费为 `AgentContext.settings`。静态字段部分本地 + 云上两端可用;动态控件 widget 部分依赖面⑤ 路线 A。
- **面⑤**:补齐第三方 slots 型 webext 的加载。缺口本质是**组件不可序列化**;补齐路径是让第三方 slots 走「代码扩展」车道(manifest 带 `entry` + SRI/签名 + 浏览器动态 import + import map 单例)。本地(路线 A)可解;云上第三方 slots 保持降级,须等 pi-clouds 阶段3 iframe 隔离车道另立 spec。

### Goals

1. 面⑦ 静态字段全链闭环(声明→端点→面板→落盘→装配注入),本地 + 云上两端等价。
2. 面⑤ 路线 A:第三方 slots 代码扩展在本地经运行时车道加载挂 SlotHost。
3. 两项共享稳定 sourceKey(对齐 registry sourceId,升版不丢配置)。
4. 全部新接缝沿用既有安全模型(trust、SRI + Ed25519、管理员门控、进程隔离);pi JSONL 协议封闭 union 零改动。

### Non-Goals

- 面⑦ 运行期实时下发(通道 b / `piweb_settings_changed`)属 M3,列可选任务;per-session 作用域留 v2。
- 面⑤ 云上 iframe 隔离车道实现(5B.*)属 pi-clouds 阶段3,另立 spec;本 spec 只记录接口预留。
- 主进程执行 source 代码;pi SDK(上游 npm)改动。

## §0. 术语与编号校正(先锁死)

两份必读文档对「七面」用了**两套编号**,本 spec 统一如下:

| 概念 | `agent-source-extensibility-module-design.md` §3 | `extensibility-parity-verification.md` §1 | 本 spec |
|---|---|---|---|
| Web UI / webext | **面4**(Web UI 五层)+ 面5(包形态) | **面⑤** webext(Web UI) | **面⑤** |
| Agent Routes | 面6 | 面⑥ | 面⑥ |
| UI Settings | 面7 | 面⑦ | **面⑦** |

「面⑦ settings」两文档编号一致;「面⑤ 第三方 slots webext」采用 parity 编号(对应 module-design 的面4 + 面5)。

**陈旧 API 名证伪**(parity §6 已警告,本 spec 代码级复核确认):module-design 面⑥⑦ 里 `defineRoutes`/`ext_http_request`/`ROUTES_NOT_DECLARED`/`registerSourceSettingsPanel`/`ext_settings_changed`/`AgentContext.settings`/`/api/config/source/:sourceId` **全部为 pre-spec 虚构,代码零命中**。面⑥ routes 真实已落地但改名 `agent-declared-routes`(走 `AgentDefinition.routes` 运行时声明,非清单声明)。**本设计一律以代码现状为准,不照抄 module-design 字面 API 名。**

## Boundary Commitments

### This Spec Owns

- 共享地基:`sourceKey(source)` 工具。
- 面⑦:清单 `settings` 段 zod schema + PluginDescriptor 切片;per-source config codec(source/project 双作用域);`/api/config/source/:sourceKey` 端点;runner 装配期注入 `ctx.settings`;`registerSourceSettingsPanel` + per-source scoped field registry;云上 `pi_clouds_source_settings` 表 + claim→configure 送达。
- 面⑤(路线 A):slots 组件编进 dist entry(带 entry manifest + SRI/签名);代码扩展 slots 运行时加载挂 SlotHost;安全门贯通与降级;第三方源本地全链 e2e。

### Out of Boundary

- 面⑦ 通道 b 实时下发(M3,可选任务 7.2);per-session override(v2)。
- 面⑤ 云上 iframe 隔离车道实现(pi-clouds 阶段3,另立 spec)。
- pi JSONL 协议封闭 union 破坏性变更;主进程执行 source 代码;pi SDK 改动。

### Allowed Dependencies

- 既有:`registerSettingsPanel`(react/config/settings-registry.ts)、`SettingsShell`(ui/config/settings-shell.tsx)、FormSchema IR + secret 三态(protocol/config)、`registerFieldRendererByKey`(ui/config/field-registry.ts)、`/config/:domain` codec 范式(server/config)、agent-declared-routes 全链(面⑥)、raw-line 侧路(state-injection-bridge)、SlotHost + SRI/Ed25519/import map 单例(ui/react/web-ext)、云上 provider_keys 分层 + EnvelopeCipher + configure 帧送达 + registryDistDeps(pi-clouds)。
- 上游 npm:pi-web-server / pi-web-kit / pi-web-agent-kit 定稿后由 pi-clouds 升版接线(`[npm]` 标注)。

### Revalidation Triggers

- pi JSONL 协议封闭 union 变更、`SlotKey` 枚举变更、`FormSchema` IR 变更、`webextNeedsIsolationLane` 语义变更、provider_keys 分层范式变更时须重评本设计。

## Architecture

### Existing Architecture Analysis

**面⑦ 已有可复用地基:**
- 面板注册表 `packages/react/src/config/settings-registry.ts:117`(`registerSettingsPanel`,含 group/tab `:50-72`,按 id 覆盖 `:90`);外壳 `packages/ui/src/config/settings-shell.tsx:61,67`(每次渲染重读注册表)。
- 「异步探测→登记→bump」先例 `lib/settings/register-panels.ts:226-238`(`registerMcpPanelIfInstalled`),调用点 `src/routes/settings.tsx:15,22`。
- FormSchema IR `packages/protocol/src/config/form-schema.ts:9-19,53-82`(widget `:78`、secret `:80`);secret 三态 `packages/protocol/src/config/secret.ts:14-58`。
- 字段 renderer 三级解析 `packages/ui/src/config/field-registry.ts:71,78,54`;服务端下发已解析 schema 先例 `config-files-field.tsx:44,51,128`。
- 通用 `/config/:domain` 读写 `packages/server/src/config/config-routes.ts:81,190-194` + codec 落 `<agentDir>/<domain>.json` `config-codec.ts:15,58,99-108`;项目级三段路由先例 `mcp-config-routes.ts:101-102`/`extensions-config-routes.ts:420-423`/`sandbox-project-routes.ts:150-151`。
- **已存在的 per-source 项目级设置雏形** `lib/app/pi-handler.ts:204-217` + `lib/app/system-resource-args.ts:55-61`(读 `<cwd>/.pi/settings.json` 覆盖 `<agentDir>/settings.json`,当前仅 loadSystemSkills/loadSystemExtensions 两键)。

**面⑦ 缺口:**(1) 域 id 是固定枚举 `packages/protocol/src/config/index.ts:31`,codec `filePath` 按固定 domain 名,无 source 维度散列;(2) `AgentContext.settings` 不存在(`packages/agent-kit/src/types.ts:22-34` 仅 cwd/agentDir/env/logger;runner `runner.ts:281-286` 不注入);(3) 无 per-source settings HTTP 端点;(4) 无稳定 sourceKey;(5) 清单无 settings 段(`plugin-manifest.ts:114-126` 只 pi/web/bindings/component 四片)。

**面⑤ 已有:**capability 枚举 `packages/protocol/src/web-ext/manifest.ts:15-24`;slots 声明 `packages/web-kit/src/define-web-extension.ts:99-113` + 20 放置点 `packages/protocol/src/web-ext/descriptor.ts:28-54`;宿主壳 `SlotHost` `packages/ui/src/web-ext/apply-extension.tsx:165-204`(prop 注入跨 bundle);挂载点 `packages/ui/src/chat/pi-chat.tsx:1590-1930` + launcherRail `components/chat-app.tsx:821-847`;resolve/dist `server/webext-routes.ts:27-75` + `lib/app/webext/resolve-webext.ts:37-60`;声明式 vs 代码扩展分叉 `packages/react/src/web-ext/extension-loader.ts:47-67`;SRI + Ed25519 + import 单例 `extension-gate.ts:58-192` + `lib/app/webext-singletons.ts:11-19`;构建期烘焙 `lib/app/webext-registry.ts:9-23,75-116`;fixture `examples/webext-slots-agent/.pi/web/web.config.tsx`。

**面⑤ 缺口(组件不可序列化):**manifest 只能序列化 SlotKey 名字数组(`descriptor.ts:68-78`),slots 组件只活在运行时 WebExtension 描述符(`define-web-extension.ts:101`)。第一方靠静态 import 成 app 单例;第三方运行时车道下发只有 manifest + baseUrl(`resolve-webext.ts:56-58`),declarative-only 时 `loadExtension` 只合成 `manifestId+config`(`extension-loader.ts:47-55`)——零组件字节到浏览器。门控注释 `lib/app/webext-registry.ts:93-96` 直白记录「运行时 resolve 无法承载组件」。

### 共享地基

#### 地基 G1:raw-line 侧路通道(自建 JSONL stdin/stdout 行)

pi RPC 是封闭 discriminatedUnion(`packages/protocol/src/rpc/response.ts:7-21`、`event.ts:108-189`、`extension-ui.ts:17-76`,合并于 `event.ts:195-198`)——新帧类型不进 union,旁路数据走「自建 JSONL 行」侧路:上行必须直写 fd1(`packages/server/src/runner/frame-channel/line-writer.ts:23-30`,`fs.writeSync(1)` 绕 `takeOverStdout` 劫持;装配期例外 `assembly-frame.ts:18-25`);主进程分派入口 `packages/server/src/session/pi-session.ts:677` `handleRawLine`(订阅 `:353`)。两种可复用模式:**广播 + 粘性回放**(`piweb_state`→`control:"state"`+`sticky.set`,`:687-708`);**请求/响应按 id 配对**(`piweb_agent_route_result` `:730-739`)。

面⑦ 复用:settings 实时下发(通道 b / 任务 7.2) = `piweb_state` 广播模式克隆,粘性帧保证重连快照不丢。

#### 地基 G2:agent-declared-routes(面⑥ 已落地,作 widget 数据端点先例)

帧 `packages/protocol/src/agent-routes/frames.ts:37-76`;runner 桥 `packages/server/src/runner/agent-routes-wiring.ts:61-102`;HTTP 端点 `packages/server/src/http/routes/agent-route-routes.ts`(清单 `:110-124`、调用 `:133-238`、门控 env `PI_WEB_AGENT_ROUTES_DISABLED` `:51` 默认开、body limit `:176-193`、timeout `:210-234`);挂载 `create-handler.ts:255-266`;session 转发 `pi-session.ts:1149-1197`。云上已透传:`apps/cloud/app/api/[[...pi]]/route.ts:1-23` catch-all,云侧零改写。面⑦ 动态控件数据端点复用它,面⑥⑦ 互为供给;面⑦ 新端点的门控/body-limit/error-map 抄此范式。

#### 地基 G3:稳定 sourceKey(新增,两项共用)

当前 source 只是裸字符串(`packages/protocol/src/transport/rest-dto.ts:40,247,301`;`packages/react/src/client/pi-client.ts:76`)。module-design 称「与 attachment store per-source 目录同法」在代码无对应物(attachment 是 per-session:`packages/server/src/attachment/config.ts:58`)。仓库唯一散列先例是 `packages/server/src/sandbox-image/template-name.ts:104`(`sha256(identity).slice(0,HASH_LEN)`)。

**决策(拍板 Q2)**:新增 `sourceKey(source)` 工具,**以 registry sourceId 作稳定输入(不含版本/channel),升版不丢配置**;sha256 短散列 + 文件系统安全字符;供面⑦ 配置目录/DB 主键、面⑤ dist 寻址/源匹配复用。落 `packages/server`(或 `packages/protocol` 若需两侧共用)。

### Technology Stack

沿用仓库既有栈:TypeScript、zod(schema 校验)、React(webext/settings 面板)、FormSchema IR、Ed25519 + sha384 SRI(webext 签名)、pi-web JSONL RPC + raw-line 侧路。云上 apps/cloud:Next.js catch-all、Supabase(pgsql)、AES 信封加密、ACS 沙箱 + bridge configure。

## 面⑦ · per-source settings 详细设计

### 数据模型

清单 `pi-web.json` 新增 `settings` 段(zod schema 放 `packages/protocol/src/plugin/`):

```jsonc
"settings": {
  "schema": "settings/schema.json",   // FormSchema 兼容(复用 form-schema.ts IR)
  "title": "CRM 助手",
  "icon": "briefcase",
  "scope": "source",                  // source(跨项目,按 sourceKey)| project(跟 cwd)
  "widgets": ["crmEntityPicker"]      // 依赖的动态控件(须由本模块 webext settingsWidgets 提供)
}
```

回退:无清单但 `settings/schema.json` 存在即启用;schema 非法降级 diagnostics + 不出面板。`resolvePiPlugin` 在 `PluginDescriptor` 产出 settings 切片。

**作用域矩阵:**

| 作用域 | 键空间 | 本地落盘 | 云上落盘 |
|---|---|---|---|
| `scope:"source"` | per-source × per-user | `<agentDir>/sources/<sourceKey>/settings.json`(0700/0600)| Supabase `pi_clouds_source_settings` |
| `scope:"project"` | per-source × per-cwd | `<cwd>/.pi/source-settings/<sourceKey>.json`(trust,拍板 Q5 独立目录)| 沙箱内 workspace |
| per-session | 不做(v2)| — | — |

`sourceKey`=G3 散列;secret 落密文/掩码引用,明文永不回浏览器(复用 `secret.ts`)。

### API/IPC 设计

**新增通用端点(挂 config 段,不开顶层段,避 module-design §11「agent-sources 404 坑」):**

```
GET  /api/config/source/:sourceKey        → { schema, values(masked), version }
PUT  /api/config/source/:sourceKey?scope= → 校验→mergeSecrets→按作用域落盘
```

实现抄 `config-routes.ts:81-194`(GET 回 `{schema, values(masked)}`、PUT `mergeSecrets:169`→zod→`codec.save`),domain 从固定枚举改动态 `source:<sourceKey>`;落盘 codec 从 `filePath(domain)` 改 per-source 目录;门控/body-limit/error-map 抄 `agent-route-routes.ts`。

**装配期注入(IPC,双通道):**
- **通道 a(装配期,主体 / M1)**:runner 装配期(`runner.ts:281-286` 构造 AgentContext 处)读 per-source `settings.json` → 注入 `ctx.settings`(类比 `option-mapper.ts:284-291` 读 auth.json 先例)。secret 解掩码后仅经 spawn env/stdin 传子进程,不落浏览器。`AgentContext` 类型面两处镜像(`packages/agent-kit/src/types.ts` + `packages/server/src/runner/agent-definition.ts`)同步新增只读 `settings`。
- **通道 b(运行期,可选 / M3)**:PUT 成功后主进程经 stdin 推 `piweb_settings_changed`(复用 G1 `piweb_state` 广播 + sticky),`liveReload` 键实时生效。

**动态控件取数据**:schema 里 `widget:"crmEntityPicker"` 的选项来源就是本模块自己的 agent-declared-routes(G2)——面⑥⑦ 互为供给。

### UI 挂载点

- 面板挂 `<SettingsShell>`(`settings-shell.tsx:61`)零改动;source 激活时 `registerSourceSettingsPanel(sourceKey)`(幂等按 id 覆盖,复刻 `registerMcpPanelIfInstalled` `register-panels.ts:226-238`);菜单项标题取清单 `settings.title`。
- 表单复用现有 FormSchema 渲染器(`field-registry.ts` 三级解析)。
- 动态控件加一层 per-source scoped field registry(`registerFieldRendererByKey` `field-registry.ts:71` 之上,`registerSourceFieldRenderer(sourceKey, key, comp)`,查找 per-source→全局,切源回收);renderer 由该模块 webext `settingsWidgets` capability 提供(依赖面⑤ 路线 A);webext 缺失/验签失败降级只读 JSON。

### 面⑦ 云上兼容(apps/cloud)

核心差异:云上消费者在沙箱内,配置须经 bridge 送达(控制面 Next 容器 ≠ 沙箱文件系统)。
- 落盘复刻 provider_keys 分层(`supabase/migrations/20260709000000_pi_clouds_app.sql:15-33`)→ 新建 `pi_clouds_source_settings(company_id, user_id nullable, source_key, payload jsonb, unique(company_id,user_id,source_key))`(与 `docs/pi-cloud-parity-gaps.md:24-28` 已对齐取舍一致)。
- secret 用信封加密 `packages/cloud-app/src/crypto/envelope.ts:12-105` + 三层解析 `keys/resolver.ts:82-125`;auth 类 secret 不走通用 config 明文回吐(`pi-cloud-parity-gaps.md:26`)。
- **送达是主工程量**(`pi-cloud-parity-gaps.md:28`):复用 `apps/cloud/lib/create-channel.ts:83-127` configure 帧下发(`:198-202`);池化约束下必须 **claim 后 configure**,不能靠 create env;沙箱内同一 runner 装配期通道 a 注入。
- **判定**:静态字段(string/secret/boolean/enum/record)云上完整工作(需云侧 config-store 落 Supabase + configure 送达);动态 widget 控件受面⑤ 缺口牵制,降级只读 JSON。

## 面⑤ · 第三方 slots webext 详细设计

### 缺口本质与补齐路径

缺口=**组件不可序列化**(见现状分析)。补齐路径=让第三方 slots 走「代码扩展」车道:
1. manifest 带 `entry`(.mjs)+ 逐文件 sha384 SRI + Ed25519 签名(`packages/web-kit/build/manifest-emit.ts:2-60` 已能产出;`canonicalManifestBytes` 排除 signature)。
2. slots 组件编进 dist,经 import map 单例(`webext-singletons.ts:11-19`)复用宿主 React/web-kit 实例。
3. dist 内容寻址分发(本地 `/api/webext/dist`,云上 registry `/v1/webext-dist`)。

**注册模型无需新建**:`SlotHost`(`apply-extension.tsx:165`)已支持运行时 `WebExtension.slots[key]` 组件挂载;代码扩展 `loadExtension` 走 `status:"loaded"`(`extension-loader.ts:57-67`)即可把 slots 组件送进宿主。缺的只是让第三方代码扩展在云上被允许下发 + 安全隔离。

### API/IPC 设计

本地:无新增端点,走既有 `/api/webext/resolve`(返回带 entry manifest)+ `/api/webext/dist/<base64url(distDir)>/<file>`(`server/webext-routes.ts:27-50`)+ 浏览器动态 import。安全门(SRI + Ed25519 + 版本 caret)复用 `extension-gate.ts:58-192`。

云上:字节托管**已就位**(baked-source 交付)——bake 抽 dist 上 OSS(`packages/registry-server/src/bake/runner.ts:381-390` + `oss-artifacts.ts:148-179`);消费端点 `/v1/webext-dist/:contentHash/:file`(`admin-http.ts:230-280`);控制面运行期拉取 `apps/cloud/lib/webext/registry-dist-deps.ts:150-191` + fetcher `registry-dist-fetcher.ts:26-58` + handler 注入 `apps/cloud/lib/handler.ts:402-419`。**真正拦路虎=隔离门** `apps/cloud/lib/webext/resolve-cloud-webext.ts:69-73` `webextNeedsIsolationLane`:entry 存在或 capabilities 含 slots → 硬拒绝下发(第三方 slots 两条都中)。

### UI 挂载点

无新挂载点,复用既有 slots 各槽区(`pi-chat.tsx:1590-1930` + `chat-app.tsx:821-847`)+ SlotHost。云上若采 iframe 隔离车道(阶段3),slots 渲染改 iframe 容器(独立 origin + postMessage),SlotHost 的 prop 注入改 postMessage 桥。

### 面⑤ 云上兼容(哪条车道支持/降级)

| 车道 | 承载 | 云上状态 | 证据 |
|---|---|---|---|
| ① 构建期烘焙(第一方)| canvas + 第一方 slots | ✅ 支持 | parity:19;`webext-registry.ts:9-23` |
| ② 运行期声明式 | 纯 config | ✅ 支持(字节托管已解封)| `registry-dist-deps.ts:150-191` |
| ②-代码扩展(带 entry/slots)| **第三方 slots 组件** | ❌ **明确拒绝** | `resolve-cloud-webext.ts:69-73` 硬拒 |
| ③ iframe 隔离车道 | 第三方代码/组件槽 | 🔜 未立 spec(拍板 Q1,pi-clouds 阶段3)| baked-source `requirements.md:148`;`pi-cloud-parity-gaps.md:12,33` |

baked-source 明确结论(`specs/baked-source/requirements.md:91-99,148`、`design.md:150-156`):registry bake 只分发**声明式** dist;第三方代码/组件槽 webext 零放宽拒绝,解法留待**阶段3 iframe 隔离车道**(独立 origin + postMessage + scoped token,依赖 baked-source 字节托管,尚未立 spec)。降级对会话无感。**接口预留(拍板 Q3)**:panel 级槽优先隔离、rail 级小件继续限声明式。

## File Structure Plan

### New Files(面⑦)

- `packages/protocol/src/plugin/settings-schema.ts` — 清单 settings 段 zod schema。
- `packages/server/src/config/source-settings-codec.ts` — per-source 落盘(source/project 双作用域,复用 config-codec 范式)。
- `packages/server/src/http/routes/source-settings-routes.ts` — `/config/source/:sourceKey` GET|PUT。
- `packages/server/src/source-key.ts`(或 protocol 共用)— G3 `sourceKey` 工具。
- `packages/react/src/config/register-source-settings-panel.ts` — 动态面板登记。
- `packages/ui/src/config/source-field-registry.ts` — per-source scoped field registry。
- `examples/module-settings-agent/` — 面⑦ 验收 fixture(清单 settings 段 + schema.json + 工厂消费 ctx.settings)。
- (pi-clouds)`supabase/migrations/*_pi_clouds_source_settings.sql`、`apps/cloud/lib/config/source-settings-store.ts`。

### New Files(面⑤ 路线 A)

- 复用既有构建/加载/门控文件为主;新增以路线 A e2e 与 fixture 接线为主(`examples/webext-slots-agent` 转第三方源加载 e2e)。

### Modified Files

- `packages/protocol/src/plugin/plugin-manifest.ts` — 清单加 settings 段。
- `packages/server/src/plugin/plugin.types.ts` + `resolve-plugin.ts` — PluginDescriptor 加 settings 切片。
- `packages/agent-kit/src/types.ts` + `packages/server/src/runner/agent-definition.ts` — AgentContext 加 `settings`。
- `packages/server/src/runner/runner.ts` — 装配期注入 ctx.settings。
- `packages/server/src/http/create-handler.ts` — 注册 source-settings 端点。
- `packages/ui/src/config/field-registry.ts` — scoped registry 接缝。
- `packages/web-kit/build/manifest-emit.ts` / `packages/react/src/web-ext/extension-loader.ts` — 面⑤ 代码扩展 slots entry 产出与加载(多为验证既有能力,按需微调)。

## Components and Interfaces

### 契约:清单 settings 段(protocol)

```ts
// packages/protocol/src/plugin/settings-schema.ts
export const PluginSettingsSchema = z.object({
  schema: z.string(),                        // 指向 FormSchema 兼容 JSON
  title: z.string().optional(),
  icon: z.string().optional(),
  scope: z.enum(["source", "project"]).default("source"),
  widgets: z.array(z.string()).optional(),
});
```

### 契约:AgentContext.settings(agent-kit + server 镜像)

```ts
// 两处镜像同步:packages/agent-kit/src/types.ts、packages/server/src/runner/agent-definition.ts
interface AgentContext {
  readonly cwd: string;
  readonly agentDir?: string;
  readonly env: Record<string, string | undefined>;
  readonly logger?: Logger;
  readonly settings: Readonly<Record<string, unknown>>;   // 🆕 装配期注入,无文件=空对象
}
```

### 契约:source-settings HTTP 端点(server)

- `GET /api/config/source/:sourceKey` → `{ schema: FormSchema, values(masked), version }`。
- `PUT /api/config/source/:sourceKey?scope=source|project` → 校验→mergeSecrets→落盘;错误码 400(校验失败)、404(挂载/未声明)、门控/413(抄 agent-route-routes)。

### 契约:动态面板登记与 scoped registry(react/ui)

- `registerSourceSettingsPanel(sourceKey)` — source 激活时幂等登记(按 id 覆盖 + bump)。
- `registerSourceFieldRenderer(sourceKey, key, comp)` — per-source scoped,查找 per-source→全局,切源回收。

### 契约:面⑤ 代码扩展 slots 加载(react/web-ext)

- manifest 带 `entry` → `loadExtension` 走 `status:"loaded"`(`extension-loader.ts:57-67`)→ SRI/签名门 → 动态 import → 挂 `SlotHost`。
- 声明式-only(无 entry)保持既有 `status:"declarative"` 行为。

## Error Handling

- 面⑦:schema 非法→diagnostics + 无面板(不 fail 模块);PUT 校验失败→400;secret 永不回读明文;端点门控/413/error-map 抄 agent-route-routes;云上 auth 类 secret 不明文回吐(走信封加密)。
- 面⑤:SRI 不匹配→拒绝加载;非白名单签名→拒绝;单槽加载/渲染失败→`ExtErrorBoundary` 隔离降级(不崩壳);webext 缺失→动态控件降级只读 JSON。
- 云上:webext 拉取/哈希校验失败→`{found:false}` 降级会话无感;第三方 slots→隔离门拒绝下发(阶段3 前保持)。

## Testing Strategy

- 面⑦:protocol settings schema 合法/非法解析单测;per-source codec source/project 双作用域落盘单测;端点 200/400/404/门控/secret 掩码单测;**装配期注入必须真实子进程集成测试**(stub 抓不到装配期注入类回归,与 state 桥同教训);前端动态登记 + scoped registry 切源回收用例;e2e:`examples/module-settings-agent` 选源→出面板→存值→新会话 systemPrompt 含值 + 降级矩阵。
- 面⑤:build 出带 entry manifest + SRI/签名断言;`examples/webext-slots-agent` 作第三方源(非静态 import)运行时 resolve→dist→import→挂 18 槽 e2e;安全门降级(篡改/坏签名被拒、单槽失败隔离)。
- 回归:workspace typecheck + 全量 test;存量无 settings/无 slots source 行为零变化;pi JSONL 协议 union 零触碰。
- 云上:依赖 pi-web 发 npm 版后接线,真机 e2e 依赖用户环境(`[cloud]`/`[npm]` 标注)。

## Security Considerations

- 面⑦:secret 三态(keep/clear/set)+ 掩码,明文永不回浏览器;`scope:"project"` 受 trust 门控;sourceKey 防路径注入;云上 secret 信封加密 + auth 类不模拟。
- 面⑤:SRI + Ed25519 白名单签名 + 版本 caret 三门俱全;import map 单例复用宿主实例(不引第二份 React);主进程不执行 source 代码(webext 只在浏览器执行,门控 SRI/签名);云上第三方组件槽保持隔离门拒绝(同源无隔离禁止是有意安全拒绝),阶段3 走 iframe 独立 origin + scoped token。

## 分期路线(M1–M4)

- **M1(面⑦ 静态主体,无面⑤ 依赖)**:tasks.md 任务 0.1、1.1–5.1,本地 per-source settings 静态字段全链 + 装配期注入。
- **M2(面⑤ 路线 A)**:任务 6.1–6.4,解锁本地第三方 slots,顺带为面⑦ 动态控件供组件。
- **M3(面⑦ 动态控件 + 实时下发)**:任务 7.1(动态控件咬合)+ 7.2(通道 b 实时下发,拍板 Q4 延后)。
- **M4(云上,依赖 npm 发版 + pi-clouds 配合 + 真机)**:任务 8.1/8.2(面⑦ 云上 config-store + 送达)+ 9.1(面⑤ 云上降级标注);iframe 隔离车道(原规划稿 5B.*)按 pi-clouds 阶段3 独立立 spec(拍板 Q1)。

## 本次 5 项拍板及理由(2026-07-19,主控)

| 编号 | 决策 | 理由 |
|---|---|---|
| Q1 | 面⑤ 先路线 A;路线 B 留 pi-clouds 阶段3 另立 spec(本 spec 只记接口预留,不含 5B.*) | 路线 A 完全在 pi-web 内、无云依赖、可与面⑦ 并行;云上 iframe 车道是安全边界改动 + 重投入,应独立立项 |
| Q2 | `sourceKey` 对齐 registry sourceId(不含版本/channel) | 升版不丢配置;避免 source 字符串变化(version/channel 切换)使已存配置「丢失」 |
| Q3 | 云上 iframe 车道 panel 级优先(阶段3 spec 输入约束) | panel 级槽大件收益高、隔离边界清;rail 级小件继续限声明式,降低阶段3 面积 |
| Q4 | 面⑦ 实时下发(通道 b / 任务 7.2)M3 延后 | v1 装配期通道已满足「改值下次会话生效」;实时下发是增量体验,不阻塞主体 |
| Q5 | `scope:"project"` 用独立 `.pi/source-settings/<sourceKey>.json` | 不污染既有 `.pi/settings.json`(loadSystemSkills/loadSystemExtensions 语义),per-source 命名空间清晰 |

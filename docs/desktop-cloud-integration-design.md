# pi-web × pi-clouds × desktop 集成设计

> 状态：**设计稿（pre-spec）**，未实现。日期：2026-07-21。
> 基线：pi-web `fa927e9`（分支 `chore/desktop-cargo-lock-0.3.0`）、pi-clouds `9837813`（main）。
> 本文严格区分「**实况**」（带 `file:line`，可核）与「**提案**」（本文新增，待评审）。
>
> **中间标准见 `docs/pi-web-host-contract-v1.md`（v1 已冻结）**——那是两端开工的权威依据；
> 本文是其设计动机与取舍，二者冲突时**以契约为准**。
>
> **主轴**：pi-web 抽出一层 **Workspace 容器**，宿主（local / desktop / cloud）只实现容器接入。
> 桌面因此天然「与本地开发同一套工作环境」——因为它用的**就是**本地那个实现。

---

## 0. 架构原则（本文的尺子）

> **pi-web 只保留标准接口；任何改动都必须向标准移动，而不是新增特例。**

推论，用来判定每一条提案是否合格：

1. pi-web 内核**不认识**「云」，也不认识任何**具体工具领域**（如 aigc / vision）。
2. 若某能力在 pi-web 里只能硬编码，**先把它抽成端口**，再谈上云。抽端口是前置工作，不是附带工作。
3. 宿主差异只允许出现在**装配层**，不允许渗进 `packages/*`。

这把尺子在本文推翻了两处既有设计（§2.1、§5）。

---

## 1. 结构性发现：装配点没有契约

**实况**：pi-web 的能力面只有一处权威装配点 —— `lib/app/pi-handler.ts` 的 `routes` 数组，共 **17 个注入式路由工厂**（14 个无条件 + 3 个条件挂载）+ `hostCommands` 等 handler options。

pi-clouds **照蓝本重写**这个数组（`apps/cloud/lib/handler.ts` 文件头自述「不 fork、不拷贝」），其 `routes` 只有 **5 项**（`handler.ts:496-500`）。

| 云端处置 | 数量 | 明细 |
|---|---|---|
| 经 pi-web 工厂替换实现 | 3 | agent-sources / favorites / session-list |
| 原样复用（换下层 store） | 1 | attachment |
| 被云端自有端点替换 | 1 | auth（`/api/login`、`/api/desktop/login`…） |
| 云端独有新增 | — | canvas-webext、internal-attachments |
| **默认消失** | **12** | 见 §10 |

**关键在于：pi-web 每新增一个路由工厂，云端不会有任何编译期或运行期信号**提示需要决策「替换 / 门控 / 复用」。于是「漏掉」与「有意弃用」在架构上不可区分。

`hostCommands` 更隐蔽：云端 `createPiWebHandler` 调用压根没传这个键（`handler.ts:485-501`），故 `/clear` 与 `/install` 在云端是**命令不存在**——不是 403，是静默缺席。可选 option 无类型约束，零信号。

→ 提案 **R3 能力面清单契约**（§4）。

---

## 2. 两种宿主形态，同一组端口

pi-clouds 消费 pi-web 的方式是**在自己进程内替换 provider**。桌面做不到——pi-web server 跑在用户本机，pi-clouds 够不着它。

> **同一组端口与线协议，adapter 装配位置不同**：
> 沙箱形态 adapter 装在 pi-clouds 进程内；桌面形态装在 pi-web 本地进程内，经 HTTPS 消费**同一批端点**。

### 2.1 ⚠️ 修正：能力注入必须是端口，不是「云端客户端」

早期草案提出在 pi-web 里加一个「Capability Bundle 客户端」。**按 §0 尺子不合格**——那是一个专门认识 pi-clouds 的组件。

**修正**：pi-web 定义端口，宿主装配期注入实现。

```ts
// packages/server/src/capability/types.ts（提案）
export interface CapabilitySnapshot {
  readonly tenant?: { userId: string; companyId: string; role: string };
  readonly egress?: EgressModelSourceInput;        // 复用既有类型
  readonly sources?: { baseUrl: string; token: string; expiresAt: number };
  readonly attachments?: { endpoint: string; token: string; expiresAt: number };
}
export interface CapabilityProvider {
  /** @param sessionId 传入则附带会话作用域能力 */
  load(sessionId?: string): Promise<CapabilitySnapshot>;
}
```

- `EnvCapabilityProvider` —— 现状行为（读 `PI_WEB_CLOUD_LOGIN_*`），**零行为变化**。
- `HttpCapabilityProvider` —— 桌面态，打云端端点换 token。

pi-web 内核只认端口，**没有一行代码知道 pi-clouds 存在**。

### 2.2 ⚠️ 不要把能力包塞进 config 域

诱人但错误的统一：既然有了 Workspace（§3），能力包算不算「远端配置域」？**不算。** 两者语义相反：

| | config 域 | capability |
|---|---|---|
| 归属 | 用户偏好 | 宿主授予 |
| 可编辑 | 是 | 否 |
| 生命周期 | 持久 | 短 TTL |
| 落盘 | `<workspace.user>/<domain>.json` | **绝不落盘** |

把 scoped token 写进 workspace 会直接违反「凭据只存钥匙串、不落盘」（§9.3）。**两个端口，不合并。**

### 2.3 云端端点

**`POST /api/desktop/capabilities`**（pi-clouds 新增）

- 鉴权：`Authorization: Bearer <桌面凭据>` → 复用 `requireCurrentUser` 既有两段分流（`apps/cloud/lib/current-user.ts:60-74`），**零新鉴权代码**。
- 请求 `{ sessionId?: string }`；响应即 `CapabilitySnapshot` 的线格式。

**必须两段式调用**：附件 token 的 payload 含 `sessionId`（`attachment-token.ts:23-27`），而桌面 sessionId 由本地铸造，登录时尚不存在。故登录时取静态车道，会话创建时带 `sessionId` 取附件 token。

**不要**为省一次往返而签发无 `sessionId` 的公司级附件 token——那会让同公司任意桌面用户读到彼此所有会话的附件，直接击穿现有隔离。

### 2.4 顺带修掉一个真缺陷

pi-web **当前不验签**桌面凭据（`packages/server/src/auth/credential.ts:7-11` 明写「验签在云端」）。后果：结构合法但签名伪造的串能进本地登录态，用户看到「已登录」，直到发第一条消息才 401。

引入 `HttpCapabilityProvider` 后，**登录动作本身就是一次真实的云端验签**——加载失败即拒绝进入登录态。这是登录语义的修正。

---

## 3. Workspace 容器 ★ 本设计的核心

### 3.1 容器已经存在，只是它现在是一个字符串

**实况**：`agentDir` 就是事实上的容器——25+ 个文件引用它，十余种落盘约定全部以它为根：

```
<agentDir>/  auth.json  models.json  settings.json  logging.json  trust-store
             sources.json  agent-source-favorites.json  session-favorites.json
             {auth,settings,sandbox,logging,aigc}.json      ← config 域
             sources/<sourceKey>/settings.json              ← per-source(user scope)
             attachments/  npm/node_modules/  git/
<cwd>/.pi/   source-settings/<sourceKey>.json               ← per-source(project scope)
```

**今天它是一个 path string；本提案是把它变成一个对象。** 注意根有**两个**（`agentDir` 与 `cwd`），不是一个——per-source settings 的两个 scope 就分别落在两个根上（`config/source-settings-codec.ts:8-13`）。

### 3.2 硬边界：两处 pi-web 根本不控制的 fs 访问

```
packages/server/src/config/model-options.ts:31-32
packages/server/src/vision-settings/vision-model-options.ts:28-29
packages/server/src/auth/egress-model-source.ts:88
  → AuthStorage.create(join(agentDir, "auth.json"))
  → ModelRegistry.create(authStorage, join(agentDir, "models.json"))
```

`auth.json` / `models.json` 是 **pi SDK 自己**的 fs I/O，pi-web 只递了个路径进去。同理 `npm/node_modules/` 与 `git/` 下的包树要被 jiti 真实载入。

**这些不可虚拟化**，除非改上游 SDK。**纯虚拟容器在 agent 边界上不可能。**

### 3.3 因此必须切成两层——混为一谈就是本设计的失败模式

| | **Layer 1 · 控制面** | **Layer 2 · agent 运行时** |
|---|---|---|
| 内容 | config 域、per-source settings、两套 favorites、`sources.json`、trust、会话条目、附件描述符 | `cwd`、真实 `agentDir`、`auth.json`/`models.json`、已装包树、jiti 载入 |
| 本质 | JSON + blob | **必须是真实 POSIX 文件系统** |
| 可虚拟化 | ✅ | ❌ |
| 现状 | **12 项缺口全部在此** | **已解决** |

**Layer 2 已经有答案且已验证**：`RpcTransport` 端口 + 三实现（本地 `PiRpcProcess` / `E2bTransport` / `SandboxWsTransport`）。云端的「容器」就是**带真实 fs 的沙箱**，同步靠烘焙镜像 + 附件/egress 远程桥解决。

这既是容器模型可行的**先例**，也划定了它的**边界**。Layer 2 因为有显式端口所以没漏；Layer 1 因为没有端口所以漏了 12 项。这不是巧合。

### 3.4 接口形状：容器是底座，不是类型化端口的替代品 ★

最容易犯的错是让容器**取代**类型化端口，变成一个通用 KV。那会丢掉 secret 三态掩码、`deepMerge` 语义、zod 校验、`sourceKey` 16-hex 防穿越校验——这些都是真实语义，散掉就是退化。

正确的是：

```
ConfigStore · per-source settings · FavoritesStore · SessionFavoritesStore ·
AttachmentRegistryPort(描述符) · TrustStore · sources 注册表
        ↓ 全部默认实现于
Workspace {
  user:    Namespace     // 原 agentDir
  project: Namespace     // 原 cwd/.pi
}
Namespace {
  readJson(key)                                   : Promise<Record<string,unknown>>
  writeJson(key, values, opts?: { merge?: boolean }): Promise<void>
  list(prefix): Promise<string[]>
  delete(key) : Promise<void>
  blob        : BlobStore                          // 复用既有端口
}
```

**云端实现 1 个 `Workspace`，白拿上列全部七个 store。** 这才是「pi-clouds 与 desktop 只开发容器接入」的准确形态。

⚠️ **`SessionEntryStore` 不在其中**（三个后端都不迁）——它是**追加日志 + 索引**，与 Workspace 的文档存储语义正交：需要事务性幂等追加、按值字段索引查询、投影读与派生列，Workspace 一样都给不了；fs 后端更是 append-only JSONL，`readJson`/`writeJson` 表达不了。详见宿主契约 §3.9。云端的正确做法是**实现该端口**（补 `SupabaseSessionEntryStore`），而非像现在这样整体绕开。

契约必须一并上提（现在藏在 `ConfigCodec` 实现里）：

- `writeJson` 默认 deepMerge、`merge:false` 覆盖写（保留删除语义）
- 本地实现须保持目录 0700 / 文件 0600（`config-codec.ts:98-107`）
- **`sourceKey` 16-hex 校验必须留在调用方**（`source-settings-codec.ts:15-18`），不能随文件系统实现一起消失——它是防路径穿越，端口化后没有 fs 也仍需校验

### 3.5 desktop = 组合，不是新容器

```
DesktopWorkspace = LocalWorkspace                  // 本地 fs，与本地开发逐字节相同
                 + blob 写目标指向云端            // 附件字节上云
                 + CapabilityProvider 注入 egress/sources
```

**「保持与本地一样的工作环境」在架构上因此成立——桌面用的就是本地那个实现。** 这也印证了 §6.5 写死的那条（桌面 config 不上云）是对的：桌面本就是单用户单机，离线可用是它的核心价值。

### 3.6 容器吸收了原 R1/R5

| 原重构 | 归宿 |
|---|---|
| R1 `ConfigStore` 端口 | **泛化为 Workspace** —— 仍是前置，但一次做完覆盖六处而非一处 |
| R5 补齐孤儿端口（`SessionFavoritesStore` 无租户实现） | **整条消失** —— 不再有「每个 store 各自的云端实现」可漏 |

R5 消失、R1 一变六，是这个 factoring 更优的实质证据。

### 3.7 风险与代价（不粉饰）

1. **爆炸半径大**：`ConfigCodec`、两套 favorites、trust-store、session store、附件描述符全要改底座。必须逐个迁移、每步行为保持不变；`LocalWorkspace` 必须是今天行为的**逐字节等价物**，否则本地开发者为抽象付税。
2. **双根不能事后加**：`user` 与 `project` 语义不同，接口一开始就得是双命名空间。
3. **过度抽象的诱惑**：一旦 `Workspace` 成了万能对象，就会有人把 spawn、网络也塞进去，最后变成第二个 `pi-handler.ts`。**边界写死：容器只管状态；计算归 `RpcTransport`，网络归 `CapabilityProvider`。**

### 3.8 验证方式：拿 config 域做垂直切片

不要一上来做全量：

```
抽 Workspace 接口 → LocalWorkspace 实现 → ConfigCodec 改建其上
  → 本地全绿(行为零变化) → pi-clouds 实现 TenantWorkspace
  → config 全域在云端直接可用，零新增路由代码
```

**若这一刀下去云端 config 真的白拿到了，模型即被验证**，再迁其余五个 store。若卡住，卡点立刻暴露，且只损失一个域的返工。

---

## 4. 其余「向标准移动」重构

R1/R5 已被 §3 吸收，剩余三项。

### R2 — 配置域注册表化

**实况**：新增一个配置域要改 **4 处**、跨 3 个包：新建域文件 → `protocol/src/config/index.ts` 的 `export *`(:23) + `ConfigDomainId` 字面量联合(:33) + `CONFIG_FORM_SCHEMAS`(:36) → `server/src/config/config-routes.ts:30` 的 `DOMAIN_SCHEMAS` → `lib/settings/register-panels.ts`。

**更有力的例证见 §5**：`ConfigDomainId` 里赫然并列着 `"aigc"` —— 一个**工具领域**混在 auth/settings/sandbox/logging 这些宿主关切里。这不只是「改 4 处」的不便，是分层错误。

**反证它可以更好**：per-source settings 走的就是动态路径——domain 参数被放宽为 `string`（`secret-merge.ts:136-140` 有专门注释），前端面板经 `registerSourceSettingsPanel` 运行时登记。**同一个仓里已有正确答案。**

**提案**：`ConfigDomainRegistry`（运行时注册 `{ id, schema, formSchema }`），与既有 `SettingsRegistry` / `FieldRegistry` 对称。新增域 = 注册一次；宿主可注册宿主特有域，插件/source 可注册自有域。

### R3 — 能力面清单契约 ★ 治本

```ts
export interface CapabilityDescriptor {
  readonly id: string;                    // "config.mcp" / "session.actions" / …
  readonly factory: (deps) => InjectedRoute[];
  readonly requires?: readonly string[];  // 依赖的端口名
}
export function defaultCapabilities(deps): readonly CapabilityDescriptor[];
```

宿主必须**显式**对每个 id 表态：`use` / `replace(impl)` / `decline(reason)`。未表态即构建失败。

有了 Workspace 之后 R3 的性质变了——默认是「全都能挂且能工作」，所以它从「防止静默漏掉」变成「**声明有意排除**」。§10 的 C 类（云端有等价物、bash 不该开）正是需要它才能与真缺口区分开。

**没有这一条，本文其余结论会在下一个路由工厂加入时再次失效。**

### R4 — `adminPolicy` 落地

**实况**：`ConfigAdminPolicy = (auth: AuthContext) => boolean` 是端口（`config-routes.ts:46`），但 `defaultConfigAdminPolicy = () => true` —— **P0 全放行**（:48-49）。

单机桌面无所谓；config 一旦经 `TenantWorkspace` 上云，全放行意味着任意租户成员可改全局配置。**Workspace 落地前必须先有 R4**，否则等于把未鉴权写面暴露到多租户环境。

---

## 5. 领域泄漏：host 不该认识 "aigc" / "vision" ★

### 5.1 实况：同一份领域知识在宿主里漏了 6 处

| # | 泄漏点 | 位置 |
|---|---|---|
| 1 | `GET /aigc/models` | `packages/server/src/aigc-settings/aigc-models-routes.ts` |
| 2 | `GET /vision/models` | `packages/server/src/vision-settings/vision-models-routes.ts` |
| 3 | **`ConfigDomainId = "auth"｜"settings"｜"sandbox"｜"logging"｜"aigc"`** | `packages/protocol/src/config/index.ts:33` |
| 4 | `ModelCatalogService.imageEntries()` —— 通用服务里的 image 命名空间 | `lib/app/pi-handler.ts:479-480,922` |
| 5 | widget 键 `aigcModelToggles` / `modelSelect` | `lib/settings/register-panels.ts:138-146` |
| 6 | 两个 `*-settings/` 目录本身 | `packages/server/src/` |

第 3 项最刺眼：`"aigc"` 与 `"auth"`/`"logging"` 并列。前者是一个工具的关切，后者是宿主关切。

### 5.2 这两个端点存在的唯一理由，是一句被文档化的绕行

`aigc-models-routes.ts` 文件头原文：

> 供 /settings 的「模型开关」自定义 widget 列举（**该页无会话态，拿不到 aigcExtension 运行期下发的 `aigc.models`**）

即：原作者已经撞上了「agent 声明式 routes 是会话锚定的」这堵墙（`agent-kit/src/types.ts:178-185`，`GET|POST /api/sessions/:id/agent-routes/:name`），设置页在会话之前，`:id` 不存在，于是绕开建了 host 端点。

**这是绕行，不是有意分层。**

### 5.3 真问题：缺一个 source 作用域的数据接缝

per-source settings 已解决了**静态那一半**——`pi-web.json` 清单的 `settings.schema` 是静态 JSON，不需要会话即可解析（`plugin/settings-schema.ts:24`）。缺的是**动态那一半**：模型清单依赖运行期凭据与 `models.json`，做不成静态 JSON。

`/aigc/models` 与 `/vision/models` 就是这个缺失接缝的手工替代品。

### 5.4 拆法：这两个端点在做两件事

| 职责 | 归属 | 现状 |
|---|---|---|
| 「列出所有已配置模型 + 能力标注」 | **host** —— `models.json` 是 workspace 上的宿主状态 | 已有且已通用：`GET /config/models` + `ModelCatalogService` |
| 「其中哪些与我这个工具相关、默认选谁」 | **source** —— 领域知识 | 硬编码在 host 里 |

**按此拆分，两个端点直接删除**：通用模型目录补上能力标注（可出图 / 可读图），领域过滤推到 source 的 settings widget（纯客户端过滤）。host 不再认识 "aigc" 与 "vision" 这两个词。

这比「改成 agent routes」更彻底，且**不需要新接缝**——静态 schema + 通用目录就够了。只有当某个 source 确实需要 host 拿不到的动态数据时，才建 source 作用域数据接缝，且要建成通用的（不是第三个 `/xxx/models`）。

### 5.5 连带处置

- 第 3 项 `"aigc"` 域 → 由 **R2** 迁出，改为 source 侧注册
- 第 4 项 `imageEntries()` → 收敛为带能力标注的通用目录
- 第 5/6 项 → 随 1/2 一同移除

---

## 6. 五条车道

### 6.1 登录与发钥

**发钥链路已完整，桌面侧零工作量。**

```
桌面凭据 → requireCurrentUser 验签 → tenant ctx
  → DefaultGatewayKeyStore.resolveKey(ctx)          // packages/cloud-app/src/keys/gateway-key-store.ts:57-75
      ├ pi_clouds.gateway_keys 命中 active → 信封解密
      └ 未命中 → HttpGatewayKeyProvisioner.issue()  // POST {ai-gateway}/admin/users/{uid}/keys
  → Authorization: Bearer sk-gw-…  → ai-gateway
```

**不变式（B-pure）：`sk-gw-*` 永不离开云端。** 上游 401 → `invalidate` + 重签 + **恰重试一次**（`desktop-egress-proxy.ts:117-121`）。缺配置 → 503 fail-closed，**绝不回退平台 key**。

配额三层（`CompanyWallet` / `UserQuota` / `APIKey`）在 ai-gateway 侧。登录形态见 §11。

### 6.2 模型目录 —— 当前真正的断点

**实况缺陷（已核实）**：选择器读磁盘，egress 只在内存，两者永不相交。

- 选择器：`listModelOptions(agentDir)` → `ModelRegistry.create(authStorage, agentDir/models.json)`（`vision-model-options.ts:29`）
- egress：`ModelRegistry.inMemory(authStorage)` + `registerProvider("pi-cloud", …)`（`egress-model-source.ts:73-99`），**只活在 runner 子进程内存里**

登录后云端模型在 UI 里**根本不存在**。这是桌面登录目前最要命的一环。

**修法复用度极高**——`GatewayModelCatalog` 已经把这件事做完了：

```
GatewayModelCatalog({ baseUrl: <egress base>, keyResolver: () => <桌面凭据> })
```

egress 是 catch-all 代理（`[...path]/route.ts:40-41` 导出 GET+POST），故 `GET {egressBase}/models` 原样转发到 `{ai-gateway}/v1/models` **并带 sk-gw**，拿回该租户可见的真实清单。再接既有 `mergeModelCatalog`：合并键已是 `${provider}/${id}` 二元组，`self ∪ gateway` 不互吞（`ai-gateway/model-catalog.ts:12-18`），stale-while-revalidate 与 fail-soft 都是现成的。

**唯一必须对齐的一处**：目录条目 provider 名必须等于 runner 注册的 `EGRESS_PROVIDER_NAME = "pi-cloud"`（`egress-model-source.ts:27`），否则「选得中、跑不了」。

副作用：手写清单 env `PI_WEB_CLOUD_LOGIN_MODELS` 可退役。**与 §5.4 合流**——这条通用目录正是领域过滤要建立在其上的那一条。

### 6.3 agent sources

**目标语义**：本地与云端**并集**。现有机制几乎不用改：`AgentSourceItem.origin` 已是 `"scan" | "registry"` 判别式（`protocol/src/transport/rest-dto.ts:244-268`），`CompositeSourceProvider` 已按 origin 排序、按 id 去重且 registry 覆盖 scan（`composite-provider.ts:44-59`）。

**提案**：新增 `RegistryHttpSourceProvider` —— 带 consume token 打 `GET {registryBase}/sources`，映射成 `AgentSourceRecord{origin:"registry"}`。它是 `AgentSourceProvider` 的又一实现，**合规**。

| 登录态 | provider 组成 |
|---|---|
| 未登录 | `sources.json` ∪ 目录扫描 |
| 已登录 | `sources.json` ∪ **云端 registry** ∪ 目录扫描 |

`createCompositeSourceProvider` 现为二元签名（`composite-provider.ts:44-46`），需扩为可变参数。⚠️ 它与端点 keyset 游标**共用同一比较器** `compareAgentSourceRecords`——语义若动，分页会漂移。

**⚠️ 刻意不复用 `@pi-clouds/registry-client`**：pi-web CLI 用它（构建期 inline），但 server 包引它会引入跨仓相对路径依赖，已知会让 worktree 构建崩。provider 只需一个 `GET /sources`，手写十几行 fetch 更划算。

**沿用的已知缺口**：`toItem()` 只透传固定字段，`runnable`/`reason` 被静默丢弃；pi-clouds 现有 workaround 是编码进 `description`（`registry-agent-source-provider.ts:18-27`）。

**安装通路**：`pi-web install <id>@<channel>` 已支持 registry 通道（`registry-install.ts:224-236`），但要手配 `PI_WEB_REGISTRY_URL`/`_TOKEN`。桌面态改由 `CapabilityProvider` 供给，用户零配置。发布仍需 publisher 私钥。

### 6.4 附件存储

线协议完全复用，`cloud-http` 后端已存在且已上线（沙箱形态见 `pi-clouds/apps/cloud/lib/create-channel.ts:547-568`）。

**关键分歧：描述符注册表放哪。** `UnionBlobStore` 是**字节**的并集（按描述符 `backend` 路由，缺省顺序探测 —— `union-blob-store.ts:36-57`），但 **`registry` 是单选**（`backends-config.ts:103-107`）。即：**描述符若跟着登录态在本地/云端间切换，历史附件会整批消失。**

| 方案 | 描述符 | 字节 | 代价 |
|---|---|---|---|
| **A（推荐）** | `local-fs`（= `workspace.user`） | 写 `cloud`、读并集 | 描述符不跨设备同步；云端 agent 列不到桌面会话附件 |
| B（与沙箱一致） | `cloud-http` | `cloud` | 登录态切换 = 历史分裂；离线完全不可用 |

**推荐 A**，与 §3.5「桌面 = 本地实现 + 云端 blob」一致。描述符里的 `backend:"cloud"` 会正确把读路由到云端——这正是该字段的设计原意（`attachment-dto.ts:33-36`）。

### 6.5 设置系统

#### 实况：pi-web 侧成熟度远高于预期

| 能力 | 状态 | 证据 |
|---|---|---|
| 通用 `/config/:domain`（5 域） | 已实现 | `config-routes.ts:81`、`protocol/config/index.ts:33` |
| 专用域（extensions / sandbox-project / mcp） | 已实现 | 各自 routes 文件 |
| secret 三态掩码 / 合并 | 已实现 | `secret-merge.ts:145,221` |
| FormSchema IR 驱动的**动态**表单 | 已实现 | `protocol/src/config/form-schema.ts:9,52,103` |
| 双注册表（面板 + 字段渲染器，含 per-source scoped） | 已实现 | `settings-registry.ts:83`、`field-registry.ts:45,144` |
| 包自带 `pi.settings` + `$schema` + 第三方 registry 三源 | 已实现 | `schema-resolver.ts:4-8` |
| per-source settings 全链（清单/端点/落盘/`AgentContext.settings`/动态面板/动态控件/实时下发） | 已实现（M1+M3） | `plugin/settings-schema.ts:24`、`source-settings-routes.ts`、`agent-kit/types.ts:47`、`register-source-settings-panel.ts:87`、`settings-changed.ts:20` |

#### 📌 文档更正：`extensibility-parity-verification.md` 面⑦ 结论已过期

该文档（`docs/extensibility-parity-verification.md:22,52,58`）判面⑦ settings 为「**C 排除 —— 上游 pi-web 未落地**」，称 `AgentContext.settings` 等「两仓零命中」「均为虚构未落地」。

**取证日期 2026-07-19，而 spec `source-settings-and-slots` 的 M1+M3 恰在同日落地**（`a7041ed`、`8487586`）。当时列为前置的三项**均已完成**：`AgentContext.settings` → `agent-kit/src/types.ts:47`；面板登记 → `register-source-settings-panel.ts:87`；`/config/source` 端点 → `source-settings-routes.ts` + `pi-handler.ts:868`。

**该文档需加更正注记。** 其「pi-clouds 侧未接线」结论仍成立。

#### 实况：pi-clouds 侧是零

`createConfigRoutes` / `createSourceSettingsRoutes` / `createExtensionsConfigRoutes` 在 pi-clouds **全仓零命中**。云端 `routes` 无任何 config 路由，且**不在 `isMultiTenant()` 门控清单里——不是"被替换或禁用"，而是从未挂载**。

云端 `/settings` 是另写的云特有页（`apps/cloud/app/settings/page.tsx:2-7` 自述），只分流到 provider-keys 与 storage。迁移里**没有任何通用 settings/config 表**；唯一 per-company 配置是 provider key（三级解析 user → org → platform，`keys/resolver.ts:83,109-126`）。

#### 提案

设置系统上云**不需要新造任何东西**：`Workspace`（§3）+ R4 + R2 三者到位后，云端注入 `TenantWorkspace` 即可整组挂载。

**桌面态沿用 `LocalWorkspace`** —— 写死在设计里：桌面 ≠ 云端瘦客户端，本地优先是刻意选择（§3.5）。

---

## 7. ⚠️ 跨车道共性缺陷：spawn env 单向下发，无法轮换

所有跨进程凭据经 **spawn env** 下发：`PI_WEB_DESKTOP_CREDENTIAL`（`pi-handler.ts:757-760`）、`PI_WEB_ATTACHMENT_TOKEN`（`pi-handler.ts:358-378`）。

**env 在进程启动后不可改。** token 一过期，子进程内的 `HttpBlobStore` / pi SDK 只能持续 401，**没有任何刷新通道**。附件 token 默认 8h（`attachment-token.ts:31`），长会话必撞。

**MVP 缓解**：桌面态把附件 token TTL 拉到 ≥ 会话上限（如 24h），401 时提示「重开会话」。

**正解**：走已收敛的 **frame-channel**。runner 四入站桥已并为单一父子 IPC 帧通道，`register(type, schema, handler)` 是现成接缝，`configure` 帧已验证在沙箱里全生效。新增 `control:credential-refresh` 帧，主进程临期推新值，子进程热替换 token 持有者。**一个机制同时修好两条车道**，建议单独立 spec。

### 7.1 关联缺陷：e2b 分支 env 下发不全

`PI_WEB_SANDBOX_ENTRY` / `PI_WEB_EXT_TOOLS_ENTRY` / `PI_WEB_AUTO_TITLE_ENTRY` 只在 real 分支下发（`pi-handler.ts:741-745`），e2b 分支（L660-710）不下发；且 e2b 另有 `envPassthrough` 白名单硬门（L697-707），并进 env 但没并进白名单的键在沙箱里不可见。

**后果**：扩展工具、自动会话标题、沙箱扩展入口三项能力在 e2b 传输下**静默不可用**。新增任何 spawn env 要改**三处**，漏一即静默失效——与 §1 同一类病：缺显式契约。

---

## 8. 装配与降级矩阵

**总开关**：`PI_WEB_CLOUD_LOGIN_EGRESS_BASE` 未配 → `/api/auth/*` 零注册（404）→ 前端判定「云端登录未启用」，无登录入口（`pi-handler.ts:963-965`、`use-desktop-auth.ts:60-67`）。**保持不变**，桌面云能力整体 opt-in。

| 状态 | 模型 | sources | 附件 | 设置 |
|---|---|---|---|---|
| 未启用 | 本地 | scan ∪ `sources.json` | `local-fs` | 本地 |
| 启用未登录 | 本地 | scan ∪ `sources.json` | `local-fs` | 本地 |
| 已登录 | 本地 ∪ **云端** | scan ∪ `sources.json` ∪ **云端** | 描述符本地，字节写云端 | **仍本地**（刻意，§3.5） |
| 登录过期 / 能力加载失败 | 退回本地 | 退回本地 | 退回本地 | 本地 |

**方向相反是刻意的**：

- **pi-web 侧一律降级可用** —— 与既有惯例一致（`GatewayModelCatalog` fail-soft、`CompositeSourceProvider` 子 provider 抛错退化为空、`registryDistDeps` 失败返回 `{found:false}`）。
- **pi-clouds 侧一律 fail-closed** —— 缺 env → 503，绝不回退平台 key。

本地降级损失功能，云端降级损失隔离。

---

## 9. 安全不变式

1. **B-pure**：`sk-gw-*` 永不出云端进程。桌面与浏览器只见桌面凭据。
2. **前端永不直连 pi-clouds**。Tauri CSP `connect-src 'self' ipc: http://ipc.localhost`（`tauri.conf.json:12-14`）在架构上强制了这点——**本地 pi-web server 是唯一云端出口**。这不是限制，是可依赖的边界。
3. **凭据只存钥匙串**：`keyring` v3，`SERVICE="pi-web-desktop"` / `ACCOUNT="desktop-credential"`（`credential_store.rs:20-22`）。单条目，切号即覆盖。**capability token 绝不进 workspace**（§2.2）。
4. **scoped token 最小权限**：附件 token 按 `(companyId, sessionId)`，consume token 按 `companyId`。归属只认 token 解出的值，忽略 body/query 自称（`internal-attachment-routes.ts:40-44`）。
5. **凭据不落日志、不进 workspace。**
6. **config 写面必须先鉴权再上云**（R4 前置于 `TenantWorkspace`）。

---

## 10. 完整性盘点：12 项缺口

云端「默认消失」的 12 个路由工厂：

| # | 工厂 | 端点 | pi-handler | 云端后果 |
|---|---|---|---|---|
| 1 | `createConfigRoutes` | `GET /config/models`、`GET·PUT /config/:domain`（五域） | 853 | Settings 无持久化；模型下拉无数据源 |
| 2 | `createMcpConfigRoutes` | `GET·PUT /config/mcp` | 852 | 无 MCP 配置面 |
| 3 | `createSandboxProjectRoutes` | `GET·PUT /config/sandbox/project` | 861 | 项目级沙箱配置不可改 |
| 4 | `createSourceSettingsRoutes` | `GET·PUT /config/source/:sourceKey` | 868 | **per-source settings 全废**（M1+M3 刚落地即云端不可达） |
| 5 | `createExtensionsConfigRoutes` | `GET·PUT /config/extensions/{global,project}` | 878 | 扩展配置不可改 |
| 6 | `createSessionActionsRoutes` | `POST /sessions/delete`、`/sessions/rename`、`GET·POST /sessions/favorites` | 898 | 会话删不掉、改不了名、收藏不了 |
| 7 | `createAigcModelsRoute` | `GET /aigc/models` | 925 | AIGC 模型下拉空 |
| 8 | `createVisionModelsRoute` | `GET /vision/models` | 932 | 视觉模型下拉空 |
| 9 | `createLlmGatewayRoutes` | `/llm-gateway/:provider/*` | 944（条件） | — |
| 10 | `createAiGatewayRoutes` | `/ai-gateway/*` | 953（条件） | — |
| 11 | `createBashRoutes` | `POST /sessions/:id/bash` | 977（默认关） | bang 命令不可用 |
| 12 | `createExtensionRoutes` | `GET·POST /extensions`、`DELETE /extensions/:extId`、`GET /sessions/:id/install-sources`、`POST /sessions/:id/reload` | 982 | **扩展装卸载全废** |

**外加一项非路由缺口**：`hostCommands`（824）—— 云端零传，`/clear` 与 `/install` 是**命令不存在**。

### 这 12 项不是一种病，是三种

| 类 | 项 | 归宿 |
|---|---|---|
| **A · Workspace 直接解决** | #1–#6（6 项） | 全是 `workspace.user` / `workspace.project` 上的纯 JSON。云端实现 `TenantWorkspace` 后**零新增路由代码**可用。§3.8 的垂直切片就选 #1 |
| **B · 本就不该存在，删除即解决** | #7、#8（2 项） | 见 §5 —— 领域泄漏，拆成「通用目录（host）+ 领域过滤（source）」后端点消失 |
| **C · 应显式弃用，不是缺口** | #9、#10、#11（3 项） | 云端有等价物（`provider-keys`/`platform-keys`/`usage`）；bash 是 RCE 面云端本就不该开 |
| **D · 撞硬边界，需另案** | #12（1 项） | 装包要落 `npm/node_modules` 并被 jiti 真实载入 → **Layer 2，必须真实 fs**。云端只能走 registry / baked image 路线（pi-clouds 已选方向） |

**C 类现在与 A/B/D 在架构上不可区分**——都是「没挂载」。这正是 R3 要解决的：让它们变成 `decline("云端有等价物")`，剩下的才是真缺口。

### 其余已知缺口（非路由）

| # | 能力面 | 说明 |
|---|---|---|
| 13 | **用量/计费双轨** | `/sessions/:id/stats` 云端可达但吐本地 token 统计；真正计费在 `usage-api` + meter，两者互不知情。**用户看到的数字与账单来自两个源。** 需 `StatsPort` |
| 14 | `SessionEntryStore` 被云端整体绕过 | 云端不实现该端口，改为替换整条 session-list 路由 + `loadResumeMeta`。「点侧栏旧会话打不开」根因已写在注释里。⚠️ **Workspace 解决不了此项**（语义正交，§3.4）——须云端补 `SupabaseSessionEntryStore`，是**独立工作项** |
| 15 | theme / keybindings 无持久化端口 | R2 落地后可作为新配置域接入 |
| 16 | logging 门控云端只能靠 env | config 域 `logging`（`pi-handler.ts:505`）云端不可达 → 退化到 env 推导 |
| 17 | `/api/bootstrap`、`/api/webext/singletons/:name` | pi-web Hono 层专属（`server/index.ts:70,58`），**不经 handler `routes` 注入**，天然不被云端继承。这类"绕过注入接缝"的能力面最易在形态迁移时遗漏 |
| 18 | `createAttachmentCatalogRoutes` | **全仓零调用点**（`attachment-catalog-routes.ts:134`）——已实现但从未装配，本地与云端均不可达。需定性 |

---

## 11. 未决项：登录形态（需拍板）

| 方案 | 形态 | 评价 |
|---|---|---|
| **A 手工粘贴**（现状） | 用户自行 `curl /api/desktop/login` 拿 token 粘进表单 | 开发者可用，产品不可交付。`login-control.tsx:11-13` 自述是 MVP |
| **B 内置邮箱密码表单** | 表单 → 本地 server 代理 → `POST /api/desktop/login` | **曾实现，已于 `fa927e9` 撤回**。CSP 决定必须经本地 server 代理，不能前端直连 |
| **C device authorization flow** | 桌面开浏览器 → 用户在 pi-cloud 网页授权 → 桌面轮询取凭据 | 密码永不进桌面进程；支持 SSO/MFA；`login-control.tsx:11-13` 已写明「生产形态由 device 授权承载」 |

方案 B 已被撤回一次，撤回原因未记录在案。**本设计不替此项拍板**——它是产品与安全的权衡，不是架构推导的结论。倾向 C 为目标形态。

---

## 12. 分期落地

**R3 与 Workspace 排在最前**，因为它们决定后续每一步是否会再次悄悄失效。

| 期 | 交付 | 依赖 | 价值 |
|---|---|---|---|
| **R0** | R3 能力面清单契约 | 无 | 「默认消失」→「显式弃用」；C 类 3 项就地关闭 |
| **W1** | `Workspace` 端口 + `LocalWorkspace` + **config 域垂直切片**（§3.8） | 无 | 验证容器模型；本地行为零变化 |
| **W2** | 迁其余五个 store 至 Workspace | W1 | 缺口 A 类 6 项 + #14 收敛 |
| **P1** | `CapabilityProvider` 端口 + 云端 capabilities 端点 + **模型目录接通**（§6.2） | R0 | 登录后云端模型**可见可选**——把「登录了但用不了」变成可用 |
| **P2** | 领域泄漏清理（§5）：删两端点、迁 `aigc` 域、目录加能力标注 | P1、R2 | 缺口 B 类 2 项；host 不再认识具体工具 |
| **P3** | `RegistryHttpSourceProvider` + composite 扩多路（§6.3） | P1 | 桌面能看到并安装租户 agent |
| **P4** | 附件云端写入（方案 A，§6.4） | P1 | 附件跨沙箱可达 |
| **P5** | R4 + R2 + `TenantWorkspace` → config 全域上云（§6.5） | W2 | 补上最大一块 |
| **P6** | `control:credential-refresh` 帧（§7） | P1–P4 | 长会话不再因 token 过期而半死 |
| **P7** | 登录形态产品化（§11） | 拍板 | 非开发者可用 |

W1 是全局关键路径（验证容器模型）；P1 是桌面侧关键路径（最小可感知价值 + P2/P3/P4 的公共依赖）。两者可并行。

---

## 附录：env 契约总表

**pi-web（本地 / 桌面）**

| 变量 | 作用 | 状态 |
|---|---|---|
| `PI_WEB_CLOUD_LOGIN_EGRESS_BASE` | 云能力总开关 + egress base | 实况 |
| `PI_WEB_CLOUD_LOGIN_MODELS` | 手写模型清单 | 实况，**P1 后退役** |
| `PI_WEB_CLOUD_LOGIN_TIMEOUT_MS` | 下限 90s | 实况 |
| `PI_WEB_DESKTOP_CREDENTIAL` / `PI_WEB_CLOUD_EGRESS_BASE` / `_MODELS` | → runner，egress 身份与清单 | 实况 |
| `PI_WEB_ATTACHMENT_BACKENDS` / `_TOKEN` / `_DIR` / `_SECRET` / `_URL_BASE` | 附件拓扑与凭据 | 实况（桌面态由 `CapabilityProvider` 组装） |
| `PI_WEB_SOURCES_ROOT` / `_REGISTRY` | 本地 sources | 实况 |
| `PI_WEB_REGISTRY_URL` / `_TOKEN` / `_INSTALL_DIR` | CLI registry 通道 | 实况（桌面态改由 `CapabilityProvider` 供给） |
| `PI_WEB_AGENT_DIR` | config 落盘根（默认 `~/.pi/agent`） | 实况，**W1 后降级为 `LocalWorkspace` 的参数** |
| `PI_WEB_WORKSPACE_MAX_VALUE_BYTES` | Workspace 单键值上限，默认 1 MiB；只在写时校验 | **提案**（宿主契约 §3.2.1） |
| `PI_WEB_SOURCE_SETTINGS_DISABLED` / `_BODY_LIMIT` | per-source settings 门控 | 实况 |
| `PI_WEB_SANDBOX_ENTRY` / `_EXT_TOOLS_ENTRY` / `_AUTO_TITLE_ENTRY` | runner 入口注入 | 实况，**e2b 分支不下发（§7.1）** |
| `PI_WEB_TRANSPORT` | 传输选择（`e2b` 等） | 实况 |
| `PI_WEB_BASH_ENABLED` | bang 命令，默认关（RCE） | 实况 |
| `SESSION_STORE` | `SessionEntryStore` 后端（fs/sqlite/postgres） | 实况，**W2 后并入 Workspace** |

**pi-clouds（服务端）**

| 变量 | 作用 | 状态 |
|---|---|---|
| `PI_WEB_MULTI_TENANT` | `isMultiTenant()` 唯一判据 | 实况 |
| `PI_CLOUDS_DESKTOP_TOKEN_SECRET` | 桌面凭据 HMAC | 实况，**部署证据未见** |
| `PI_CLOUDS_AI_GATEWAY_BASE_URL` + 4 项 `_SUPABASE_*` / `_ADMIN_*` | 发钥，五项全配才构造 | 实况 |
| `PI_CLOUDS_ATTACHMENT_TOKEN_SECRET` / `PI_CLOUDS_ATTACHMENT_BASE_URL` | 附件 | **已部署** |
| `PI_CLOUDS_OSS_*`（4 项） | 对象存储 | **已部署** |
| `PI_CLOUDS_REGISTRY_HTTP_BASE_URL` / `_CONSUME_TOKEN_SECRET` | registry | 代码已接线，**部署 env 未确认** |

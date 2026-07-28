# Research Log · publish-key-lifecycle

发现类型：**Extension**（在既有发布链路上补一环），故走 light discovery：只查集成点、既有形态、约束边界，不做外部技术选型（Ed25519 与文件形态早已被既有代码定死）。

---

## 1. 勘察实证（全部本轮实测，非回忆）

### 1.1 pi-web 侧

| 事实 | 依据 | 对设计的影响 |
|---|---|---|
| 密钥文件形态 `{publicKey, privateKey}`（base64 raw 32B） | `server/cli/publish/manifest-compiler.ts:414` `KeyMaterial` + `readKey()` | 生成侧必须产出**同一形态**，否则 `sign()` 读不了 |
| `readKey()` 已有三态错误：`missing` / `unreadable` / `malformed` | 同上 `:423-439` | Req 1.6「坏文件不覆盖」有现成错误码可复用，不必新造语义 |
| `sign()` 调 registry-client 的 `signManifest`，不自实现 | `:446-480` | 生成也应调 `generateEd25519KeyPair`，保持"一份实现" |
| `manifest-compiler.ts` **静态** import `@pi-clouds/registry-client` | `:26` | 该文件已在这条依赖边上；同目录新增 keystore **不引入新约束** |
| `lib/app/publish-preview.ts` 静态 import `manifest-compiler`，而 `package-host-command.ts` 又静态 import 它 | `publish-preview.ts:30`、`package-host-command.ts:39` | 说明这条链在生产（esbuild alias）与 dev 下都已成立 |
| jiti dev 下 `import("@pi-clouds/registry-client")` **实测可解析** | 本轮跑 `node --import jiti-register -e "import('@pi-clouds/registry-client')"` → `OK function` | `registry-channel-adapter.ts` 文件头那条"静态引入即崩"的断言，至少对本包**当前已不成立**（jiti 认 tsconfig paths）。**但本设计不依赖这一点**——见 D2 |
| pi-web 本机根目录约定是 `~/.pi-web/`（`agents` 为源根） | `lib/app/pi-handler.ts:276`、`server/cli/context.ts:52` | 密钥放 `~/.pi-web/keys/` 与既有约定同根 |
| CLI `publish` **强制** `--key`，dry-run 也要 | `server/cli/index.ts:516-527` | 这是"用户当前无受支持方式拿到密钥"的直接后果；改为可选即让 Req 1 端到端可验 |
| `getPublishGrant()` 已存在但**零消费者** | `packages/server/src/auth/desktop-capabilities-client.ts` | 本 spec 是它的第一个消费者（P1 只铺了管道） |
| host command 的 publish 分支：非 dry-run → `PUBLISH_NOT_AVAILABLE`；dry-run → `previewPublish` | `lib/app/package-host-command.ts:495-519` | 登记调用点插在预览之前，输出面不动 |

### 1.2 pi-clouds 侧

| 事实 | 依据 | 对设计的影响 |
|---|---|---|
| `PublisherKey` 只有 `fingerprint` / `publicKey` / `status` | `registry-client/src/types/entities.ts:44-51` | 本 spec 要补的正是溯源字段 |
| publisher 的 `keys` **整体落 jsonb**，读时整体 `as PublisherKey[]` | `registry-server/src/store/pg-registry-store.ts:140-145`（`toPublisherRow` / `fromPublisherRow`）+ `adapters-aliyun/src/pg-registry-client.ts:164-186`（`keys jsonb`） | ★ **加字段零迁移、零 store 改动**。这是本 spec 能"现在就补元数据"的技术前提 |
| `addPublisherKey` 是 admin 门，且带**跨 publisher 唯一性**检查（遍历 `listPublishers`） | `registry-client/src/service/registry-service.ts:176-204` | 窄口必须走它，不得旁路；唯一性约束**保持不变** |
| 重复同一把钥匙 → `ValidationError("key already present")` | 同上 `:181` | 幂等语义须在窄口层吸收该错误（视为成功），而非放宽 service |
| cloud 侧 `CloudTokenVerifier.verifyPublish` **恒抛**（只读钉子） | `apps/cloud/lib/registry.ts` | 不动它；复用 P1 的 `ProvisioningTokenVerifier`（进程内 nonce） |
| P1 已有 `getProvisioningRegistry()` + `resolvePublishIdentity()`（含 provision publisher，幂等） | `apps/cloud/lib/registry.ts`、`lib/publish-identity.ts` | 登记路由可直接复用，**无需**先接线 capabilities 路由 |
| `registerPublisher` 的 `keys` 映射会重算指纹并置 `enabled` | `registry-service.ts:165-170` | 加元数据要同时改这里，否则两条入口产出的记录形态不一致 |
| 桌面路由范式：`requireCurrentUser(req, deps)` → 纯函数 → `toErrorResponse` | `apps/cloud/app/api/desktop/capabilities/route.ts` | 新路由照抄该薄接线 |
| `generateEd25519KeyPair()` 存在且是纯计算 | `registry-client/src/manifest/signature.ts:89` | 复用；只需改注释里的"供 seed 与测试用" |

---

## 2. 关键裁断（含被否掉的方案）

### D-a：登记走**独立路由**，不搭 capabilities 顺风车

否掉的方案：把公钥塞进 `POST /api/desktop/capabilities` 的请求体，在组装快照时顺手登记。

否掉的理由：capabilities 是**读**（快照），塞进去会让"取能力"变成"写台账"——此后任何一次能力刷新都是一次写库，且写失败与读失败的语义会纠缠在同一个响应里。独立路由让失败面各归各的。

### D-b：`publisherId` **永不来自请求体**

登记路由只收 `{publicKey, label?}`。publisher 由认证得到的 `companyId` 经 `derivePublisherId` 派生。这是 Req 2.3 的**结构性**保证——不是校验出来的，是"根本没有那个入参"。

### D-c：元数据字段设为**可选**，缺省在**写入侧**补

否掉的方案：`createdAt` / `label` 设为必填。

否掉的理由：存量记录（seed 建的内置源公钥）没有这两个字段，必填会让读取端一律判死——Req 3.3 明确禁止。改为可选 + 登记入口写入时补默认 label，效果等价（新记录恒有值），但不判死存量。

### D-d：本地回执做幂等**短路**，但服务端仍须自身幂等

回执 `~/.pi-web/keys/registered.json` 只是省一次网络往返；用户删掉它、换机器、并发调用都会导致重复登记请求，故服务端把 `key already present` 当成功是**必需**的，不是优化。

---

## 3. 风险

| 风险 | 缓解 |
|---|---|
| ★ 本 spec 落地后，已配置 org 的用户**首次 `/agent publish --dry-run` 就会真的往生产 registry 写**（provision publisher + 登记公钥） | 这是本 spec 的目的，但必须在实施闸门前向用户明说；实施时可先在 staging 验证 |
| `addPublisherKey` 这道 admin 门首次被开出入口 | 三条同时成立的收窄：publisherId 派生不可外传 / 只加不删 / 跨 publisher 唯一性不放宽。须同步改写 `apps/cloud/lib/registry.ts` 顶部那段"addPublisherKey 仍无入口"的注释——注释与事实不符比没有注释更危险 |
| 自动生成会让每台机器多一把 enabled 公钥 | 正是 Req 3 元数据要解的；本 spec 不做撤销入口（Out of scope），但元数据先就位，撤销入口后补时有依据 |
| 私钥经日志/输出面漏出 | 输出面只出现 `publicKey` / `fingerprint` / 路径；单测显式断言私钥字符串不出现在 reporter 输出与卡片数据中 |

# Implementation Plan

> **跨两仓**。每个任务标注所属仓库与工作树：
> - **[web]** `agents/pi-web/.claude/worktrees/agent-plugin-commands`（分支 `feat/agent-plugin-commands`）
> - **[cloud]** `agents/pi-clouds/.claude/worktrees/registry-org-identity`（分支 `feat/registry-org-identity`）
>
> **红线**：任何任务都不得对生产 registry / 生产库执行写操作。单测一律用 `InMemoryRegistryStore` 与注入的假 store。

---

- [x] 1. registry 侧：`PublisherKey` 溯源元数据

- [x] 1.1 **[cloud]** 给 `PublisherKey` 加可选溯源字段
  - `packages/registry-client/src/types/entities.ts`：新增 `createdAt?: string`（ISO 8601）与 `label?: string`
  - 两字段**必须可选**：存量记录（seed 建的内置源公钥）没有它们，设为必填会一律判死
  - 就地注释写清「为什么可选」与「不参与验签判定」
  - 完成态：`pnpm -F @pi-clouds/registry-client typecheck` 通过，且既有测试零改动即绿
  - _Requirements: 3.1, 3.3, 3.4, 3.5_
  - _Boundary: registry-client/types_

- [x] 1.2 **[cloud]** 两条写入口同步产出元数据
  - `registry-service.ts` `addPublisherKey(token, publisherId, publicKey, meta?)`：新增可选第 4 参 `{ label?, createdAt? }`；`createdAt` 缺省取 `this.clock`，`label` 原样透传（不在此层补缺省 —— 缺省属登记入口的语义，见任务 2.2）
  - `registerPublisher` 的 `input.keys[]` 映射同步带上 meta，**两条入口产出的记录字段集必须一致**
  - 跨 publisher 唯一性检查与 admin 门**一行不动**
  - 完成态：新增测试断言两条入口产出的 `PublisherKey` 字段集相同；`key already present` 与跨 publisher 冲突两条既有拒绝路径行为不变
  - _Requirements: 3.1, 3.2, 2.4_
  - _Depends: 1.1_
  - _Boundary: registry-client/service_

- [x] 1.3 **[cloud]** 元数据单测
  - `packages/registry-client/test/publisher-key-meta.test.ts`
  - 覆盖：带 meta 登记 → 记录含 `createdAt`/`label`；**存量无 meta 的 `PublisherKey` 仍能被读取且 `verifyManifest` 通过**（构造无 meta 的 publisher 走完整验签）；元数据不影响 `status === "enabled"` 的遍历判定
  - 完成态：`pnpm -F @pi-clouds/registry-client test` 全绿，新增用例 ≥ 6 条
  - _Requirements: 3.3, 3.4, 5.4_
  - _Depends: 1.2_
  - _Boundary: registry-client/test_

- [x] 1.4 **[cloud]** admin HTTP 面透传可选 label (P)
  - `packages/registry-server/src/http/admin-registry-http.ts`：`POST /v1/admin/publishers/:id/keys` 的请求体支持可选 `label`，透传给 `addPublisherKey`
  - 不加必填字段 —— 既有调用方不传 label 仍须成功
  - 完成态：既有 registry-server 测试零改动即绿；新增一条「不传 label 仍 200」的断言
  - _Requirements: 3.2_
  - _Depends: 1.2_
  - _Boundary: registry-server/http_

---

- [x] 2. cloud 侧：公钥登记的窄口

- [x] 2.1 **[cloud]** 重写 `registry.ts` 里关于 `addPublisherKey` 的安全注释
  - `apps/cloud/lib/registry.ts`：现有注释断言「真正危险的 `addPublisherKey` 仍然没有任何入口」——**本 spec 使该断言失效**，必须先改口再开门（注释与事实不符比没有注释更危险）
  - 改写为新的三条收窄条件：① `publisherId` 不在请求体、由认证 `companyId` 派生 ② 本入口只加不删 ③ 跨 publisher 唯一性不放宽
  - 完成态：`ProvisioningTokenVerifier` 与 `publish-identity.ts` 中所有声称"addPublisherKey 无入口"的文字全部更新，`grep -rn "没有任何入口" apps/cloud` 零命中
  - _Requirements: 2.3, 2.6_
  - _Boundary: apps/cloud/lib/registry_

- [x] 2.2 **[cloud]** 登记纯函数 `registerPublishKey`
  - 新建 `apps/cloud/lib/publish-key-registration.ts`，签名见 design.md
  - 流程：复用 `resolvePublishIdentity`（取 `{org, publisherId}` 并幂等 provision）→ `addPublisherKey`
  - `label` 缺省落 `"desktop"`（Req 3.2：缺省要明确，不留空）
  - **幂等吸收**：service 抛 `key already present` → 返回 `ok: true`
  - 跨 publisher 冲突 → `KEY_CONFLICT`，**不回显**冲突方 publisherId
  - org 未配置 → `ORG_NOT_CONFIGURED`，且**不触发任何 registry 写**
  - 完成态：模块不 import 任何 HTTP/Next 类型（纯函数、可单测）
  - _Requirements: 2.1, 2.2, 2.3, 2.4_
  - _Depends: 1.2, 2.1_
  - _Boundary: apps/cloud/lib/publish-key-registration_

- [x] 2.3 **[cloud]** 路由 `POST /api/desktop/publish/keys`
  - 新建 `apps/cloud/app/api/desktop/publish/keys/route.ts`，照抄 `desktop/capabilities/route.ts` 的薄接线（`isMultiTenant` 门 → `getCloudDeps` → `requireCurrentUser` → 委托 → `toErrorResponse`）
  - 请求体**只有** `{ publicKey, label? }`；**不得**接受 `publisherId` / `companyId` / `org` 任一入参
  - 状态码映射：401 未认证 / 403 `ORG_NOT_CONFIGURED` / 409 `KEY_CONFLICT` / 400 `INVALID_KEY` / 503 `UNAVAILABLE`
  - 响应体 `{ fingerprint, publisherId, org }`，不含任何 token / 私钥
  - 完成态：`curl` 形态自检 —— 请求体带 `publisherId` 时该字段被完全忽略（不是报错，是根本没读）
  - _Requirements: 2.1, 2.3, 2.6_
  - _Depends: 2.2_
  - _Boundary: apps/cloud/app/api/desktop/publish/keys_

- [x] 2.4 **[cloud]** 登记单测
  - `apps/cloud/test/publish-key-registration.test.ts`
  - 覆盖：org 未配置 → `ORG_NOT_CONFIGURED` 且 registry **零调用**；publisher 不存在 → 先 provision 再登记，一次成功；重复同一把钥匙 → `ok: true`（幂等）；钥匙已属他人 → `KEY_CONFLICT` 且响应**不含**对方 publisherId；registry 抛异常 → `UNAVAILABLE` 而非崩
  - 完成态：`pnpm -F cloud test` 全绿（先跑基线，确认既有 26 条红是存量、非本次引入）
  - _Requirements: 2.2, 2.3, 2.4, 2.5, 5.3_
  - _Depends: 2.2_
  - _Boundary: apps/cloud/test_

---

- [x] 3. pi-web 侧：本机密钥就位

- [x] 3.1 **[web]** keystore 模块 (P)
  - 新建 `server/cli/publish/keystore.ts`：`resolvePublishKeyPath()` + `ensurePublishKey()`，接口见 design.md
  - 路径优先级：显式入参 > `PI_WEB_PUBLISH_KEY_PATH` > `~/.pi-web/keys/publish.json`
  - 目录 `0700`、文件 `0600`；生成调 registry-client 的 `generateEd25519KeyPair()`，**不自实现密码学**
  - 已有且可解析 → 原样复用；**已有但解析失败 → `KEY_MALFORMED` 并停止，绝不覆盖**
  - 返回值**只含**路径/publicKey/fingerprint/created —— 私钥不进返回值（Req 1.4 的结构性保证）
  - 完成态：与 `manifest-compiler.ts` 同目录，`node --import jiti-register -e "import('./server/cli/publish/keystore.ts')"` 可解析
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 4.2_
  - _Boundary: server/cli/publish/keystore_

- [x] 3.2 **[web]** keystore 单测
  - `test/publish-keystore.test.ts`（真实临时目录，不 mock fs）
  - 覆盖：无密钥 → 生成且产物能被 `manifest-compiler.sign()` 读通；已有合法密钥 → **文件字节前后完全相同**；坏文件（非 JSON / 缺字段）→ `KEY_MALFORMED` 且**文件字节不变**；新建文件 `mode & 0o777 === 0o600`、目录 `0o700`；路径优先级三档
  - **私钥不出现**断言：把生成的私钥字符串在返回值 JSON 与 reporter 输出中全文搜索，必须零命中
  - 完成态：新增用例 ≥ 10 条全绿
  - _Requirements: 1.3, 1.4, 1.5, 1.6, 5.1, 5.2_
  - _Depends: 3.1_
  - _Boundary: test/publish-keystore_

- [x] 3.3 **[web]** CLI `--key` 改为可选
  - `server/cli/index.ts` `runPublish`：省略 `--key` 时走 `ensurePublishKey()` 取本机密钥；显式 `--key` 仍最高优先
  - 删掉两处「缺少 --key」的 usage 报错；`KEY_MALFORMED` 走新文案，明确指出「请修复或移走该文件」，**绝不提示自动重建**
  - 首次自动生成时经 reporter 提示密钥路径与指纹（**不含私钥**）
  - 更新 `bin/pi-web.mjs` 的 `--key` 帮助文案为「可选」
  - 完成态：在临时目录跑 `pi-web publish --dry-run`（无 `--key`、`HOME` 指向临时目录）能产出已签名清单并退出 0
  - _Requirements: 1.1, 1.4, 4.2_
  - _Depends: 3.1_
  - _Boundary: server/cli/index_

- [x] 3.4 **[web]** ★ 签名 ↔ 验签端到端互通测试
  - `test/publish-sign-interop.test.ts`
  - keystore 生成密钥 → 对夹具包跑 `compile()` + `sign()` → 断言 `verifyManifest(signed, publicKey) === true` 且 `signed.publisher === computeFingerprint(publicKey)`
  - **两侧各测各的测不出形态不一致**，这是唯一能抓住「生成产物签不动 / 验不过」的断言
  - 完成态：该测试在 keystore 产出形态被人为改坏（如 base64url 换 base64）时必然红 —— 实施时手工验证一次这个反向性质
  - _Requirements: 1.2, 5.5_
  - _Depends: 3.1_
  - _Boundary: test/publish-sign-interop_

---

- [x] 4. pi-web 侧：公钥自动登记接线

- [x] 4.1 **[web]** 能力客户端新增 `registerPublishKey()`
  - `packages/server/src/auth/desktop-capabilities-client.ts`
  - `POST <capabilitiesUrl 同源>/api/desktop/publish/keys`，`Authorization: Bearer <桌面凭据>`
  - **不抛**，失败以判别式返回 `{ok:false, kind}`（与 `getSourcesGrant` 同规）
  - publish grant 的 `token` **不参与**本请求（登记走桌面凭据，两者作用域不同，混用会扩大 publish token 用途）
  - 日志只记 fingerprint 与结果类别，不记 publicKey 全文、不记凭据
  - 完成态：单测覆盖 401/409/网络失败三条路径均返回而不抛
  - _Requirements: 2.1, 2.5, 2.6_
  - _Depends: 2.3_
  - _Boundary: packages/server/auth/desktop-capabilities-client_

- [x] 4.2 **[web]** 登记编排 `ensurePublishKeyRegistered`
  - 新建 `lib/app/publish-key-registration.ts`，接口与流程图见 design.md
  - best-effort：任何一步失败**静默返回**，不抛、不改调用方输出
  - 本地回执 `<keydir>/registered.json` 记 `{fingerprint, publisherId}` 做幂等短路；**仅在服务端确认成功后才写**
  - `label` 缺省 `os.hostname()`
  - 完成态：回执命中时**不发任何网络请求**（用假 fetch 断言零调用）
  - _Requirements: 2.1, 2.2, 2.5_
  - _Depends: 3.1, 4.1_
  - _Boundary: lib/app/publish-key-registration_

- [x] 4.3 **[web]** 接入 host command 与装配
  - `lib/app/package-host-command.ts`：dry-run 预览分支在 `previewPublish` **之前**调一次 `ensurePublishKeyRegistered`（best-effort，不 await 失败处理）
  - `lib/app/pi-handler.ts`：注入 `getPublishGrant` / `registerPublishKey`（照 `getSourcesGrant` 既有注入位置）
  - 非 dry-run 分支的 `PUBLISH_NOT_AVAILABLE` 行为**一字不改**
  - 完成态：`/agent publish --dry-run` 在登记失败（无授予 / 网络断）时输出**逐字节不变** —— 用现有 e2e/单测的期望值做回归比对
  - _Requirements: 2.1, 2.5_
  - _Depends: 4.2_
  - _Boundary: lib/app/package-host-command, lib/app/pi-handler_

- [x] 4.4 **[web]** 登记编排单测
  - `test/publish-key-registration.test.ts`
  - 覆盖：无授予 → 不发请求、不写回执、不抛；回执命中 → 零网络调用；服务端 409 → 不写回执且静默；成功 → 写回执且内容含 fingerprint 与 publisherId、**不含**任何 token
  - 完成态：新增用例 ≥ 6 条全绿
  - _Requirements: 2.2, 2.5, 5.3_
  - _Depends: 4.2_
  - _Boundary: test/publish-key-registration_

---

- [x] 5. 收尾验证

- [x] 5.1 **[web]** 两仓全量测试与基线归因
  - **先跑基线**：`git stash` 后分别跑两仓测试，记录存量红（已知：pi-web login 项目 5 条、packages/server attachment 集成 flake、apps/cloud 26 条）
  - 再跑本次改动，逐条比对；**任何新增红必须归因到本次改动并修掉**
  - pi-web 须跑全部测试面：根 vitest + `packages/{server,ui,tool-kit,protocol}`（只跑根会漏子包红）
  - 完成态：一份新旧对照表，新增红为零
  - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - _Depends: 1.3, 1.4, 2.4, 3.2, 3.3, 3.4, 4.4_
  - _Boundary: 跨仓验证_

- [x] 5.2 **[web]** 「不提供导出/同步」的负向断言
  - 全仓 grep 确认：无任何命令 / 输出面打印私钥，无任何路径把密钥文件复制到别处
  - 在 `keystore.ts` 文件头写清这是**有意的能力缺失**（提供了就等于回到「私钥在机器间传」，本机持钥便失去意义）
  - 完成态：`grep -rn "privateKey" server/ lib/ bin/ --include="*.ts" --include="*.mjs"` 的每一处命中都能说明为何不构成导出路径
  - _Requirements: 4.4, 1.4_
  - _Depends: 3.3_
  - _Boundary: 全仓审查_

- [x] 5.3 **[web]** 更新跨仓文档与实施状态
  - `docs/registry-publish-identity-design.md`：把 Q2「公钥从哪来」标为已裁定（本机生成 + 自动登记），并记下 P2 的剩余阻塞项
  - `.kiro/specs/publish-grant-issuance/requirements.md` 的实施状态表：注明 P2 的密钥前置已由本 spec 解除
  - 完成态：两处文档与代码事实一致，无遗留的「未决/待定」表述
  - _Requirements: 4.3_
  - _Depends: 5.1_
  - _Boundary: docs_

---

## 实施红线（每个任务都适用）

1. **不碰生产**：不对生产 registry / 生产库发起任何写。真机验证须先请示。
2. **不放宽既有约束**：admin 门、跨 publisher 唯一性、`CloudTokenVerifier.verifyPublish` 恒抛 —— 三者一行不动。
3. **私钥零输出**：不进返回值、日志、错误消息、卡片数据、测试快照。
4. **`/agent publish` 输出不变**：本 spec 只加副作用，不改任何用户可见输出。

## Implementation Notes

### 与设计不同 / 值得记的发现

1. **`PublisherKey` 加字段确实零迁移** —— `toPublisherRow` 把 `p.keys` 整体塞 jsonb、
   `fromPublisherRow` 整体断言回来（`pg-registry-store.ts:140-145`）。加字段不碰 store、不碰 DB。
   这条在设计阶段是推断，实施时逐行核实成立。

2. **`makeKey()` 抽成 service 私有方法**（设计未明说）。两条写入口原本各写一遍字段字面量，
   加字段时极易只改一处 → 两条入口产出的记录字段集漂移。已加断言钉住二者相同。

3. **`label` 的缺省落在登记入口，不在 service** —— service 层擅自填 `"desktop"` 会掩盖
   "这条记录其实没人说明来源"（平台手工登记可能有意留空）。

4. **cloud 侧幂等/冲突只能靠 message 判别** —— 二者都是 `ValidationError`、`code` 同为
   `VALIDATION`，但用户含义相反（一个成功、一个拒绝）。已在测试里逐字钉住两条 message，
   service 改文案会立刻红。

5. **指纹在客户端本地算**（`computeFingerprint`），不从响应或错误对象里捞 ——
   成功与幂等命中两条路径因此走同一条求法，不会给出不同指纹。

6. **`reporter` 没有 `note()`** —— 密钥生成提示改为拼进 `start()` 的 detail，不新增 reporter API。

7. **顺手修了一处存量红**：`packages/server/test/identity/identity-providers.test.ts` 的两个
   `DesktopCapabilitiesClient` stub 在 P1 加 `getPublishGrant` 后就没补，typecheck 一直红。
   本次加第二个成员时一并补齐（基线已用 `git stash` 确认是存量，非本次引入）。

8. **`registry-channel-adapter.ts` 文件头那句「静态引入 registry-client 即崩 dev」对本包已不成立** ——
   实测 jiti 认 tsconfig paths（`import('@pi-clouds/registry-client')` 在 jiti 下 OK）。
   本次设计**不依赖**这一点（keystore 放在已在同一依赖边上的 `server/cli/publish/`），
   但那条注释值得后续复核。

### 验证结果（2026-07-28）

| 面 | 结果 |
|---|---|
| pi-web 根 vitest | 981 passed / 0 failed |
| pi-web packages/server | 2435 passed |
| pi-web packages/ui | 851 passed |
| pi-web packages/tool-kit | 463 passed |
| pi-web packages/protocol | 417 passed |
| pi-web 根 typecheck | 0 error |
| pi-clouds registry-client | 252 passed / **1 failed（存量：`dist-exports` publishConfig.access）** |
| pi-clouds registry-server | 218 passed |
| pi-clouds sandbox / adapters-aliyun | 189 / 78 passed |
| pi-clouds apps/cloud | 658 passed / **26 failed（存量，改动前后同为 26）** |

**新增红：零。**

真机自检：临时 HOME 下跑 `publish --dry-run` **不带 `--key`** → 退出 0，
自动生成 `~/.pi-web/keys/publish.json`（实测权限 `-rw-------`），输出仅含路径与指纹。

### 未做（有意）

- **未接线生产写入**：`resolvePublishIdentity` 仍未接进 capabilities 路由（P1 Req 4 遗留）。
  本 spec 的登记路由自带 provision，不依赖它。
- **未在真实云端/生产 registry 上验证** —— 那会产生生产写入，须另行请示。

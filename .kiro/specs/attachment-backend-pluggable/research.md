# Research & Design Decisions — attachment-backend-pluggable

## Summary
- **Feature**: `attachment-backend-pluggable`
- **Discovery Scope**: Extension(既有 attachment-store / attachment-tool-bridge 体系的可插拔化扩展)
- **Key Findings**:
  - 仓内已有完全同构的可插拔先例:`session-store`(`{kind}` 判别联合配置 + 工厂 switch + env 解析未知 kind 即 throw),attachment 后端选择直接对齐该模式,不发明第二套风格。
  - 全仓无 AWS SDK 依赖;仓库文化倾向零新第三方运行时依赖(`id.ts`「零新第三方依赖」、sqlite 走 node 内建)。S3 访问采用 fetch + 手写 SigV4 纯函数实现。
  - 公开 id `att_<16B base64url>` 无路由信息且在 `blob.put` 前铸造 → 读路由权威只能放描述符层;分发生命周期长于会话/进程 → 绑定必须落盘(pre-spec 设计稿不变式,已由需求 3.1/3.3/4.4 固化)。
  - 子进程经 `createChildAttachmentStore(env)` 用同一 config 工厂重建 store,且以「`PI_WEB_ATTACHMENT_DIR` 未下发 = 能力不可用」门控;多后端拓扑下该门控须扩为「DIR 或 BACKENDS 任一下发即可用」。

## Research Log

### 既有可插拔存储先例(接口风格对齐)
- **Context**:attachment 各模块注释反复引用「接口风格与既有可插拔存储(session-store-adapters)对齐(Req 1.8)」。
- **Sources Consulted**:`packages/server/src/session-store/{types,factory}.ts`。
- **Findings**:配置为判别联合 `{ kind: "fs" | "sqlite" | "postgres", ... }`;工厂 `switch(config.kind)`;env 解析函数把未知 kind 直接 `throw new Error("unknown ...")`(fail fast);错误类型带 `SessionStore*` 前缀防 barrel 冲突。
- **Implications**:`PI_WEB_ATTACHMENT_BACKENDS` 的条目形状取 `{ kind: "local-fs" | "s3", name, ... }` 判别联合;构建工厂同形 switch;非法拓扑装配期 throw(Req 2.2)。

### S3 客户端依赖形态
- **Context**:Req 5 要求 S3 兼容后端(blob + registry 双层),需决定引依赖还是自实现。
- **Sources Consulted**:全仓 package.json 扫描(无 `@aws-sdk/*`);`id.ts`/`sqlite-store` 的零依赖先例;AWS SigV4 官方签名流程文档(HMAC-SHA256 链,node:crypto 全覆盖)。
- **Findings**:`@aws-sdk/client-s3` 体积大、传递依赖多,与 CLI standalone 打包(nft 拍平、payload 自包含)有既知摩擦;本 spec 只需 PUT/GET/HEAD/DELETE/LIST + query presign 五种请求,SigV4 纯函数 ≈150 行,官方 test suite 提供权威向量。
- **Implications**:手写 `sigv4.ts` 纯函数(node:crypto)+ 最小 fetch 客户端;单测钉 AWS 官方签名向量;真实 S3 兼容服务的集成测试经 env 门控(未配置即 skip),不进默认 CI 路径。

### 主/子进程重建与能力门控
- **Context**:Req 6 主/子进程存储视图一致;既有 child-store 以 DIR 下发与否门控能力。
- **Sources Consulted**:`packages/server/src/attachment-bridge/child-store.ts`、`lib/app/pi-handler.ts` spawn env 段(Req 7.3/7.4)。
- **Findings**:子进程复用同一 `attachmentStoreConfigFromEnv`;凭据经 `*Env` 间接引用 → 主进程必须把「拓扑 env + 其引用的全部凭据 env」一并下发,否则子进程构建 S3 后端在装配期报缺变量(Req 2.4)反而崩会话。
- **Implications**:config 工厂返回值扩一项 `passthroughEnv`(须下发的变量名→值),pi-handler 在既有 DIR/SECRET 旁展开合入 spawn env;child 门控改为 `DIR || BACKENDS` 任一存在。

### S3 registry 的 listBySession 索引
- **Context**:本地 registry 靠目录扫描过滤 sessionId;S3 无高效「按字段过滤」。
- **Findings**:对象布局 `att/<id>.json`(描述符)+ `by-session/<sessionId>/<id>`(空对象索引);save 先写描述符再写索引(幂等覆盖);listBySession = ListObjectsV2 前缀枚举 + 并发 GET 描述符。
- **Implications**:语义与本地一致(Req 5.2);吞吐优化明确 out of scope(requirements Boundary Context)。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 端口+组合后端(选定) | `BlobStore`/`AttachmentRegistryPort` 端口,UnionBlobStore 作 composite 注入门面 | 门面/调用方零改动;与既有端口设计同向;描述符权威路由满足生命周期约束 | put 回执化是内部端口签名变更,触所有实现与 mock | 与 session-store 模式一致 |
| union 自持路由映射(旁路文件) | union 在自己目录记 id→backend | 不动描述符协议 | 路由状态又落单机盘,云端多副本自相矛盾 | 否决 |
| 逐后端探测为常态读路径 | 读时按序试 | 实现最小 | 延迟叠加、错误语义模糊、无法表达「绑定失配」 | 仅保留为存量对象迁移期回退(Req 4.2) |
| 引入 @aws-sdk/client-s3 | 官方 SDK | 签名/重试成熟 | 体积与 standalone 打包摩擦;仓库零依赖文化 | 否决,改手写 SigV4 |

## Design Decisions

### Decision: 读路由权威 = 描述符 `backend` 字段,探测链仅迁移期回退
- **Context**:id 无路由信息;分发生命周期长于会话。
- **Selected Approach**:`BlobStore.put` 返回 `PutReceipt{backendName?}`,门面固化进描述符;union 读路径经注入的 `resolveBackendName(key)`(工厂接 registry)命中后端;无绑定走声明顺序探测;绑定指向未注册后端 → 明确配置错误不静默探测(Req 4.3)。
- **Trade-offs**:内部端口签名变更(既有实现返回 `{}` 即兼容)换取路由状态与描述符同生命周期、天然随 registry 可插拔上云。
- **Follow-up**:门面 put 的回滚路径在 union 下仍删「选中后端」(receipt 已知)。

### Decision: 拓扑 env 单变量 JSON + 凭据 `*Env` 间接引用
- **Context**:Req 2(可版本化、不含明文凭据)+ 不变式「配置完全 env 可表达」。
- **Selected Approach**:`PI_WEB_ATTACHMENT_BACKENDS` 承载 zod 校验的 JSON 拓扑;凭据字段存宿主变量名;工厂在装配期解引用,缺失即 throw 指出变量名。
- **Trade-offs**:env 里放 JSON 略不常规,但 spawn 透传一个变量即可整体复制拓扑,优于散装多变量。

### Decision: S3 访问 = fetch + 手写 SigV4(零新运行时依赖)
- 见 Research Log「S3 客户端依赖形态」。测试锚点:AWS 官方签名向量单测 + env 门控集成测试。

### Decision: registry 更名带兼容别名
- **Context**:`AttachmentRegistry` 类被 config/bridge/barrel 多处引用。
- **Selected Approach**:提端口 `AttachmentRegistryPort`;类更名 `LocalFsAttachmentRegistry`;barrel 保留 `export { LocalFsAttachmentRegistry as AttachmentRegistry }` 兼容别名,存量导入零破坏。

## Risks & Mitigations
- SigV4 实现错误(签名不过/安全弱化)— 官方向量单测钉死 + canonical request 纯函数分层可单测 + 集成测试门控真实服务验证。
- 拓扑 env 与凭据 env 下发不同步致子进程装配崩 — `passthroughEnv` 由 config 工厂单点产出,pi-handler 只展开不拼装;集成测试覆盖 Req 6.1/6.2。
- put 回执化波及既有测试 mock — 回执 `{}` 为合法返回,mock 改动机械;tasks 阶段列专项。
- 存量对象探测链在多后端下放大读延迟 — 仅在「无绑定」路径触发;文档建议存量单后端部署把 local 放声明首位。

## References
- `docs/attachment-union-store-design.md` — pre-spec 设计稿(本 spec 的直接输入,含 UnionBlobStore 参考实现)
- `packages/server/src/session-store/{types,factory}.ts` — 可插拔存储先例(接口风格权威)
- `packages/server/src/attachment/*`、`packages/server/src/attachment-bridge/*` — 被扩展的既有切片
- AWS SigV4 signing process 官方文档与测试向量 — 签名实现与单测锚点

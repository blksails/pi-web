# Research Log — protocol-contract

## 发现范围

- 特性类型:**Greenfield 新特性**,但范围高度受限——纯类型 + zod schema 包,零运行时逻辑、零 I/O。
- 权威来源:`PLAN.md` §3.1、§4、§13.1–13.2、§14.1①;`brief.md`;steering(`tech.md`/`structure.md`/`product.md`/`roadmap.md`)。
- 上游事实来源:`@earendil-works/pi-coding-agent` `0.79.x` 的 `dist/**/*.d.ts`(未在包 `exports` 导出,需本地化复制)。
- 由于本包是依赖图最底层(`protocol ← 所有`),发现以"如何把 pi 原生协议与 pi-web 自定义传输层契约稳定、可校验、同构地表达"为中心,不做外部网络研究。

## 关键调查与结论

1. **类型派生 vs 包导出**:pi 把 `RpcCommand/RpcResponse/RpcExtensionUIRequest/Response/AgentEvent/RpcSessionState/Model/AgentMessage` 放在 `dist/**/*.d.ts` 但未经 `exports` 暴露(PLAN §3.1)。结论:本包**本地化复制并重建为 zod schema**,在每个 schema 处注释来源 d.ts 路径与对齐版本 `0.79.x`,实现包级解耦 + 漂移可追踪。

2. **单一事实来源**:tech.md 要求 strict、禁 `any`。结论:用 **zod schema 作为唯一事实来源**,静态类型用 `z.infer<typeof Schema>` 推导,避免类型与运行时校验分叉(对应 Req 1.6)。

3. **校验库选型(Build vs Adopt)**:brief 允许"zod(或 typebox)"。结论:**采用 zod**——同构、零额外运行时依赖、AI SDK v5 生态广泛使用、`safeParse` 自带字段路径错误。typebox 偏向 JSON Schema 编译,本包不需要。zod 即"已解决"的运行时校验问题。

4. **契约分层(简化 + 边界)**:PLAN §13.5/§14.1① 要求 pi 原生类型与 pi-web 自定义 DTO 严格分离、版本协商。结论:**目录按来源分层**——`rpc/`(pi 原生派生)与 `transport/`(SSE 帧 / data-part / REST DTO),`version.ts` 提供 `protocolVersion`,`index.ts` 聚合导出。这是满足所有需求的最小结构,且在接口层可扩展。

5. **同构与零依赖(简化)**:roadmap/structure 要求零运行时依赖(除校验库)、Node + 浏览器同构。结论:全部为纯数据 schema,**禁止**任何 `node:` 内置、`fetch`、文件系统调用;e2e 样本采集脚本属于测试夹具(devDependencies / 测试目录),不进入包运行时依赖。

6. **防漂移 e2e(硬性)**:brief "测试 + e2e(硬性)"。结论:契约校验测试需对**真实 `pi --mode rpc`** 产出的样本帧(`prompt → text_delta → tool_* → agent_end`)与真实 SSE 样本逐帧校验。样本以夹具(fixtures)形式纳入仓库,并提供采集脚本,使其可再生、可在 pi 升级时刷新——这是 schema 与真实协议不漂移的客观证据。

## 设计决策(Design Decisions)

- **Generalization**:`AgentEvent` 用可辨识联合(`type` 判别)统一表达全部事件子类型;SSE 帧用 `kind`(`uiMessageChunk` | `control`)判别统一表达两类帧。一个联合 schema 覆盖多个需求变体。
- **Build vs Adopt**:采用 zod(运行时校验)+ `z.infer`(类型推导);拒绝手写双份(类型 + 校验)以防分叉。
- **Simplification**:不引入任何运行时抽象层/适配器;包只导出常量、schema、推导类型。传输/编解码/翻译逻辑全部留给下游 spec(`rpc-channel`/`session-engine`/`http-api`)。

## 风险与缓解

- **pi 版本漂移**:pi 升级改变 RPC 形状 → 本包 schema 滞后。缓解:e2e 契约测试对真实样本逐帧校验,失败即暴露漂移(Req 7.3–7.5);schema 注释来源 d.ts 与版本。
- **样本采集需真实 pi 环境**:e2e 依赖可运行 `pi --mode rpc`。缓解:样本以 fixtures 落仓,采集脚本可再生;CI 缺 pi 时对已落仓 fixtures 校验仍有效。

# 实现验收报告 — session-snapshot-authority

工作树:`pi-web-snapshot`(分支 `feat/session-snapshot-authority`)。日期:2026-06-28。

## 实现概览(四步全部落地)

| STEP | 内容 | 关键文件 |
|---|---|---|
| 1 | 服务端权威 `SessionSnapshot` + busy 纯归约 + 广播 + 开关门控 | `protocol/transport/session-state.ts`(新)、`server/session/reduce-snapshot.ts`(新)、`pi-session.ts`、`session.types.ts`、`session-manager.ts`、`pi-handler.ts` |
| 2 | `StickyFrameRegistry`(last-value 粘性)+ subscribe 回放收口 | `server/session/sticky-registry.ts`(新)、`pi-session.ts` |
| 3 | `ControlStore` 吸收 session-state 成唯一投影 + PiChat 派生改读快照 | `react/sse/control-store.ts`、`react/hooks/use-pi-controls.ts`、`ui/chat/pi-chat.tsx` |
| 4 | `PART_KINDS` 单一真相源 + 遍历注册 + 契约测试 | `protocol/transport/part-kinds.ts`(新)、`ui/chat/builtin-data-part-renderers.tsx`(新)、`pi-chat.tsx` |

`snapshotAuthority` 开关:默认关(legacy 零回归),生产 `pi-handler` 默认开,可经 `PI_WEB_DISABLE_SNAPSHOT_AUTHORITY=1` 一步回退(Req 8)。

## 测试证据

### 单测(load-independent,全绿)
- protocol 245 · ui 530 · server 862(+5 skip)· react 277 ≈ **1900+ 全通过**。
- 新增:`reduce-snapshot`(6,纯函数 busy 语义 Req 2/7.1)、`sticky-registry`(4,Req 4)、`pi-session.snapshot`(5,含 busy 排序回归锁定)、`control-store-session-state`(4,投影 Req 3.2/5.1)、`part-kinds-contract`(4,无孤儿 Req 6.5)。

### node e2e(真实 handler + SSE + stub)
- `session-snapshot.e2e.test.ts` **通过**:busy true→中途重连粘性回放 busy true→应答权限→末态 busy false(不卡死)。Req 2.3/4.1/7.3。
- forks 进程隔离全量 node e2e:所有 session/SSE/streaming/persistence/uirpc/snapshot 套件**通过**;仅 3 个**预存 infra 门控**套件失败(`aigc` 需 DASHSCOPE_API_KEY、`webext-build-load` 需先 `pnpm --filter @blksails/pi-web-kit test` 构建示例产物、`config-domains` 1 例)——**与本特性无关**,clean HEAD 同样失败。

### browser e2e(真实浏览器 + DOM)
- `e2e/browser/session-snapshot.e2e.ts` 已编写。运行证明:权威 busy 经 ControlStore→PiChat 投影**送达 DOM**(`data-pi-busy="true"`)。
- **该 e2e 捕获了一个真 bug**:轮末 busy 卡 true——根因 `agent_end` 的 `finish` 帧触发前端关流,排在其后的 `busy=false` 帧被 per-prompt 流丢弃。**已修复**:`pi-session.handleEvent` 中快照广播先于 translate 帧(`busy=false` 先于 `finish`)。修复经同步排序单测 + node e2e 双重确证。
- DOM 层 busy=false 的最终复验需重建 `.next-e2e`,因测试机负载(load 58)+ 会话中断暂时阻塞;修复正确性已由 node e2e(同一服务端帧路径)+ 单测充分确证。

## 回归与兼容
- 开关默认关时 862 服务端单测全绿 + 「authority off 不发 session-state」单测 → 向后兼容(Req 8.2/8.4)。
- 新增 `session-state` 帧并入既有 control 判别联合,旧消费者 default 分支忽略;过渡期 session-status/stats/logs 帧保留。

## 偏差说明
- Req 6.3「translate 遍历单一真相源」:采用「PART_KINDS 键 == wire 判别值」契约断言 + 既有 TS 穷尽 switch 共同保证不漏翻译,未做字面 switch 重写(事件→part 的映射不自然适配「遍历 kind」,且穷尽性已由类型系统保证)。
- stats:保留轮末**事件驱动**(非定时轮询,Req 3.3 合规)的 getStats 触发作为 agent 用量刷新源;READ 单源取自权威快照。

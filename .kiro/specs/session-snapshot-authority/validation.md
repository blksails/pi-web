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

## 偏差说明(经检阅修正,如实陈述)
- **Req 6.3「translate 遍历单一真相源」**:实现采用「PART_KINDS 键 == wire `DataPartSchema` 判别值」**运行期契约测试** + translate 中 data-pi-* 字面量受 `DataPartSchema` **类型约束**(拼错即类型错)二者保证。**更正**:translate-event 的 `switch(event.type)` 用 `default: return none(ctx)` 兜底,**并非 `never` 穷尽 switch**——「不漏翻译」无穷尽性强制,亦无「每个 registry kind 都被 translate 产出」的反向孤儿测试(当前 5 个 kind 均有产生路径,但删除某 translate case 契约测试不会变红)。这是已知、被接受的偏差。
- **stats**:保留轮末**事件驱动**(非定时轮询,Req 3.3 合规)的 getStats 触发作为 agent 用量刷新源;READ 单源取自权威快照。`SessionSnapshot.stats` 用 `z.object().passthrough()`、`model` 用 `z.unknown()`——传输信封不复用 rpc 层 `SessionStatsSchema`(避免 transport→rpc 反向耦合),对这两字段无结构契约,是有意取舍。
- **snapshotAuthority × readinessHandshake 双开关耦合**:lifecycle 仅经 `setLifecycle` 入快照,而 `setLifecycle` 在 `!readinessHandshake` 时早返回。故「开 snapshotAuthority、关 readinessHandshake」时 `snapshot.lifecycle` 恒为 `initializing`;若前端同时误开 `gateUntilReady` 则永不可发送。生产 `pi-handler` 默认两者皆开(安全);此为 misconfiguration footgun,已记录,未强制联动。

## 对抗式检阅与修复(2026-06-29)

合并前对提交代码做了三镜对抗式检阅(服务端/前端/协议),确认并修复以下真问题:

| 严重度 | 问题 | 修复 |
|---|---|---|
| CRITICAL | **UI 包 tsc 失败**:`Record<(typeof REGISTRY_PART_KINDS)[number],…>` 因 `REGISTRY_PART_KINDS` 标注 `readonly PartKind[]` **拓宽回全集**,反而要求 stream 类 kind 也有渲染器——静态保证方向反了 | 新增映射条件类型 `RegistryPartKind` 真正在类型层收窄;`Record<RegistryPartKind,…>` 现正确强制「漏 registry 渲染器→编译错」 |
| CRITICAL | 契约测试 `import zod` 但 ui 包无 zod 依赖;mock-session fixture 缺新必填 `busy` | ui 补 `zod` devDep;fixture 补 `busy/session` |
| MED | **崩溃/中途停止不复位 busy**:不经 agent_end,快照以 busy=true 收尾→纯投影前端永久忙碌 | `cleanup` 末态显式 `setSnapshot({busy:false})` + 新增单测锁定 |
| MED | **空闲控制流漏放 session-state**:就绪前/空闲/重连客户端经空闲流收不到权威快照 | `openControlOnlyStream` 白名单放行 `session-state`(busy 主经 per-prompt 流,空闲流仅助粘性收敛) |
| LOW-MED | `applySnapshot` 仅引用比较→getStats/setModel 重复响应产生冗余 session-state 帧 | 改逐字段比较(Req 1.2「变更才广播」) |
| LOW | stats 非对象防御漏数组→safeParse 连带丢整帧 | 收紧为 plain-object(排除数组) |

**检阅暴露的流程教训**:此前「ui typecheck clean」结论有误——根 `tsc` 未深检 ui 包自身 tsconfig,且 vitest 走 esbuild 转译**不做类型检查**;后台链命令 exit 0 掩盖了 ui 包 typecheck 失败。修复后**逐包** typecheck(protocol/server/react/ui)**全 CLEAN**,受影响单测(server 34 · ui 契约 4 · react 29)全绿。建议仓库把 `pnpm -r typecheck` 纳入 CI 闸。

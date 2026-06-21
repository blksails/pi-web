# Research Log — new-by-agent-source

**Discovery 类型**：Light（app 层 UI/状态小改）。

## 关键发现

1. **会话创建入口集中在 `ChatApp`**（`components/chat-app.tsx`）：`onSubmit(source)` 用 `buildCreate(props, source)` 建会话；`onReset()` 退回 `AgentSourcePicker` 并 `history.replaceState(null,"","/")`。`create.source` 即当前 agent source。
2. **`usePiSession` 不响应 `create` 变化重建**（`packages/react/src/hooks/use-pi-session.ts`）：`start()` 被 `startedRef` 守卫（`:101-103`），自动启动 `useEffect` 为 `[]` 依赖、仅挂载时跑一次（`:166-173`）。→ 结论:同源新建**不能靠改 prop**,必须强制 `SessionView` 重新挂载。
3. **重挂方案**：`ChatApp` 维护 `nonce`，`SessionView` `key=\`${source}#${nonce}\``；bump nonce → 卸载+重挂 → 新 hook → `createSession(同一 source)` → 新会话。`onSessionId` 既有副作用同步 URL `/session/:newId` 与登记 source 映射（`:191-203`），无需额外处理。
4. **恢复模式陷阱**：经 `/session/:id` 冷加载时 `session.resumeId` 有值。若同源新建只 bump nonce 不丢 resumeId,重挂会"再次恢复旧会话"。→ `onNewByAgentSource` 必须把 session 置为仅含 `create`(丢 resumeId)。
5. **测试 mock 限制**：`test/chat-app.test.tsx` 把 `usePiSession` mock 成固定活动会话,无法在组件层观测"新 id"。→ "新 session id"核心行为放 e2e(真实后端)验证;组件层验"切换源→选择器出现""新建→仍停留会话"。

## 设计决策（synthesis）
- **Build-vs-adopt**：完全复用既有 `buildCreate`/`onReset`/`onSessionId`/`AgentSourcePicker`;仅新增 `nonce` + `onNewByAgentSource` + 一个按钮(最小增量)。
- **key 组成**：`${source}#${nonce}` —— 切源(source 变)与同源新建(nonce 变)都会改 key,语义统一。
- **不抽象**：不引入新组件/hook;就地改 `ChatApp`/`SessionView`。

## 风险与缓解
- 恢复模式下新建 → 已在 `onNewByAgentSource` 丢弃 resumeId 规避(见发现 4)。
- e2e 隔离:遵循 `NEXT_DIST_DIR=.next-e2e` + external server（[[pi-web-e2e-isolated-build]]）,dev 在跑时不碰 `.next`。

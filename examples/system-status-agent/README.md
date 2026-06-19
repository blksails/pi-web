# system-status-agent

组合演示 **server-driven UI**(`data-pi-ui`)与 **ambient 状态/通知**(`extension_ui_request`)的 example agent —— 在一个 `health_check` 工具里把两条链路组合成一次真实的"健康检查"。

## 它演示什么

| 能力 | API | 前端表现(pi-web) |
|------|-----|------------------|
| 进度状态条 | `ctx.ui.setStatus(key, text \| undefined)` | 顶部状态条;传 `undefined` 清除该 key |
| 指标卡 / 表格 | `emitUi(onUpdate, { kind: "builtin", component })` | 内置白名单组件零配置渲染 |
| 报告面板 | `emitUi(onUpdate, { kind: "sandbox", root })` | 受限节点树(只读、白名单、URL 校验) |
| 完成通知 | `ctx.ui.notify(message, "info")` | 通知浮层 |

> `emitUi` / `ctx.ui` 仅在工具执行期间有效。同一份 agent 在 pi CLI 亦通用(状态行 / 终端通知)。

## 运行

前端指向本目录即可(`usePiSession({ create: { source: "./examples/system-status-agent" } })`),
然后让 agent "做一次系统健康检查",它会调用 `health_check`。

`model` 省略 → 继承 `~/.pi/agent/settings.json` 的默认 provider/model;凭据取自 `~/.pi/agent/auth.json`。

## 控制 Reasoning(思考块)外观

思考块(reasoning part)的外观由**前端**控制(agent 只产生 reasoning 内容,不控外观)。两种方式:

1. **内置增强(opt-in)**——默认 `PiReasoning` 已对齐 ai-sdk Reasoning 行为,按需开启:
   ```tsx
   // 经 components.Reasoning 复用内置组件并开启 ai-sdk 风格
   <PiChat
     session={session}
     components={{
       Reasoning: (props) => (
         <PiReasoning
           {...props}
           streamingAutoOpen            // 流式期间自动展开、结束自动收起
           getThinkingMessage={(streaming, sec) =>
             streaming ? "Thinking…" : sec ? `Thought for ${sec}s` : "Reasoning"
           }
         />
       ),
     }}
   />
   ```

2. **完全自定义**——传入任意组件(契约即 `PiReasoningProps`:`{ part, defaultOpen?, ... }`):
   ```tsx
   <PiChat session={session} components={{ Reasoning: MyReasoningPanel }} />
   ```

> 参考 ai-sdk Reasoning(https://elements.ai-sdk.dev/components/reasoning):流式自动展开、"Thought for X seconds" 时长、可折叠触发器——这些在内置 `PiReasoning` 中以 `streamingAutoOpen` + `getThinkingMessage` 提供。

## 相关示例

- `server-driven-ui-agent` —— 只演示 server-driven UI(builtin + sandbox)
- `ui-demo-agent` —— 只演示交互(select/confirm/input)与 ambient(setStatus/notify)
- 本示例 —— 把 server-driven UI 与 ambient 组合在一个工具里

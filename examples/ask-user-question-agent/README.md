# ask-user-question-agent

演示如何用 `ask_user_question` 工具向用户发起结构化澄清：当上下文不足以在多个合理方案之间作出选择时，agent 会在对话流中展示一张问题卡，而不是自行猜测。

## 它演示什么

| 关注点 | 做法 |
|---|---|
| 工具接入 | 从 `@blksails/pi-web-tool-kit/runtime` 导入 `askUserQuestionTool`，通过 `customTools` 注册 |
| 决策边界 | 仅在存在多个合理方案且无法从上下文推断用户意图时提问 |
| 结构化问题 | 每个选项提供短标签与影响 / 取舍说明，答案回到模型后继续任务 |
| 避免臆测 | system prompt 明确禁止替用户猜选项；上下文已有答案时不重复询问 |
| model 省略 | 继承 `~/.pi/agent/settings.json` 的默认 provider / model |

## 运行

```bash
pi-web ./examples/ask-user-question-agent
```

前端 source 指向本目录即可。可以尝试：

- “帮我给新 API 设计认证方式，JWT 和 session 都可以，但我还没决定。”
- “为这个功能选择持久化方案；如果上下文无法确定，请先问我。”

当选择可由已有上下文推断时，agent 应直接继续；只有多个方案都合理且偏好未知时，才调用 `ask_user_question`。

## 工作方式

工具复用 pi-web 既有的 extension UI `select` 往返：新前端识别富载荷并渲染多题卡片，用户提交后模型收到结构化答案；旧前端仍可退化为普通单选。示例本身无需额外前端配置。

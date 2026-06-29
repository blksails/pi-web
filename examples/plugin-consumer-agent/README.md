# plugin-consumer-agent

**消费方示例**:演示「安装插件后零改动复用」——本 agent 自身不含任何 `code_review` 工具代码,全部能力来自安装的 `@acme/code-review` 插件。

## 它演示什么

本示例与 `plugin-code-review-agent` 配套:

- **插件提供方**(`plugin-code-review-agent`):注册 `code_review` 工具 + `/review` 命令 + 富卡渲染器。
- **消费方**(本示例):通过 `.pi/settings.json` 的 `extensions` 字段本地安装插件;agent 自身 `index.ts` 不含任何插件能力代码。

安装后消费方自动获得:

| 能力 | 来源 |
|------|------|
| `code_review` 工具 | 插件的 `extensions/code-review.ts` |
| `/review` 斜杠命令 | 同上 |
| `CodeReviewCard` 富卡渲染 | 插件的 `.pi/web/dist/` webext |

## 运行

```bash
pi-web ./examples/plugin-consumer-agent
```

然后要求 agent 检视代码,例如:「review 这段:`var x = 1; if (x == 1) {}`」

## 关于 `allowLocal`

dev 模式下使用 `local:` 协议安装插件需放开信任:

```bash
PI_WEB_TRUST_PROJECT=1 pi-web ./examples/plugin-consumer-agent
```

或在服务端建会话时传 `trust: true`。

## 相关示例

- [`plugin-code-review-agent`](../plugin-code-review-agent/) — 双角色:插件提供方 + 可自运行 agent
- [`pi-probe-agent`](../pi-probe-agent/) — `.pi/extensions` 加载探针基础

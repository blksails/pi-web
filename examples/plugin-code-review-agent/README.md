# plugin-code-review-agent

**双角色示例**:既是可独立运行的 agent source,也是可发布/安装的 pi 插件包。

## 它演示什么

| 角色 | 说明 |
|------|------|
| 自运行 agent | `pi-web ./examples/plugin-code-review-agent` 直接启动,`.pi/extensions` 自动加载扩展 |
| 可安装插件 | `pi-web.json` 统一清单 + `package.json`(`@acme/code-review`)声明可发布;消费方 `extensions: ["local:../plugin-code-review-agent"]` 安装即用 |

### 两层咬合契约锚点:`code_review`

| 层 | 路径 | 说明 |
|----|------|------|
| pi 扩展 | `extensions/code-review.ts` | 注册 `code_review` 工具 + `/review` 命令;包根真身 |
| pi 扩展(自运行转发) | `.pi/extensions/code-review.ts` | 薄 re-export,让 SDK top-level 发现路径指向包根 |
| pi 提示模板 | `prompts/*.md` | `/review-snippet`、`/review-staged`、`/review-security` 三个斜杠命令,展开成调用 `code_review` 工具的提示 |
| Web 渲染器 | `.pi/web/web.config.tsx` | `renderers.tools.code_review` → `CodeReviewCard` 富卡 |
| Web 贡献点 | 同上 | `contributions.slash` 接入 `/review` 命令补全 |
| 清单绑定 | `pi-web.json` → `bindings.tools` | 声明 `code_review` 为对外契约 |

## 目录结构

```
plugin-code-review-agent/
├── pi-web.json          # 统一插件清单
├── package.json            # 可发布声明(@acme/code-review)
├── index.ts                # 自运行 agent 入口
├── extensions/
│   └── code-review.ts      # pi 扩展真身(被安装时扫此)
├── skills/
│   └── code-review/
│       └── SKILL.md        # 指导 LLM 调用 code_review 工具
├── prompts/                # 提示模板真身(被安装时扫此)
│   ├── review-snippet.md   # /review-snippet <code>
│   ├── review-staged.md    # /review-staged [关注点]
│   └── review-security.md  # /review-security [路径]
└── .pi/
    ├── extensions/
    │   └── code-review.ts  # 自运行转发:re-export 包根真身
    ├── prompts/            # 自运行副本(markdown 无法 re-export,与 .pi/skills 同理两处各一份)
    │   ├── review-snippet.md
    │   ├── review-staged.md
    │   └── review-security.md
    └── web/
        ├── web.config.tsx  # Tier2 渲染器 + Tier3 slash 贡献点
        └── dist/           # 构建产物(build-webext-examples.ts 生成)
```

## 提示模板(prompts)

`prompts/*.md` 是 pi 原生「提示模板」——每个 `.md` 即一个斜杠命令,选用后把正文(含
`$1`/`$ARGUMENTS`/`${1:-默认}` 参数替换)展开为发给 LLM 的提示。本插件提供三个:

| 命令 | 说明 | 演示的替换语法 |
|------|------|---------------|
| `/review-snippet <code>` | 检视粘贴的代码片段 | `$ARGUMENTS`(全部参数) |
| `/review-staged [关注点]` | 检视 Git 暂存区改动 | `$ARGUMENTS`(可空尾随) |
| `/review-security [路径]` | 安全审计视角检视 | `${1:-默认值}`(缺省回退) |

三者都引导 agent 调用 `code_review` 工具,以富卡呈现结果(与 skill 同一渲染路径)。

> 与扩展 / skill 一样,提示模板也分两处:被安装(`origin:package`)时扫**包根** `prompts/`
> 并由 `pi-web.json` 的 `pi.prompts` 声明;自运行(`origin:top-level`)时 SDK 扫 `.pi/prompts/`。
> markdown 无法像扩展那样 re-export,故两处各放一份(与 `.pi/skills` 样板同理)。

## 运行

### 自运行模式

```bash
pi-web ./examples/plugin-code-review-agent
```

然后让 agent 检视一段代码:「请帮我 review 这段 JS:`var x = 1; if (x == 1) {}`」

### 作为插件安装(消费方模式)

在另一个 agent 的 `.pi/settings.json` 中:

```json
{ "extensions": ["local:../plugin-code-review-agent"] }
```

消费方 agent 无需包含任何 code_review 相关代码,全部能力来自安装的插件。参见 `examples/plugin-consumer-agent/`。

## 构建 web 扩展产物

```bash
node --import jiti/register scripts/build-webext-examples.ts
```

产物写入 `.pi/web/dist/`(含 `web-extension.mjs` + `manifest.json`)。

## 相关示例

- [`plugin-consumer-agent`](../plugin-consumer-agent/) — 消费方:安装本插件后零改动复用
- [`webext-renderer-agent`](../webext-renderer-agent/) — Tier2 自定义渲染器基础
- [`webext-contrib-agent`](../webext-contrib-agent/) — Tier3 贡献点(slash / @mention)

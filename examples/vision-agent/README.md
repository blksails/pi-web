# vision-agent — 视觉识别（图像理解）

演示 `image_vision` 工具与 `/img_vision` 命令：把**已落库的附件图**交给一个支持图像输入的模型，取回文字结论。

## 这个示例解决什么问题

用户上传的图会作为多模态 image part 直接送给主模型。但**落库之后**（AIGC 生成图、工具产出图），
它在对话上下文里只剩一个文本标记：

```
[attachment id=att_kZ3q… type=image/png name=cat.png]
```

模型读得到 id，**读不到像素**。想让它再看一眼，以前只能请用户重新上传。

`image_vision` 把这个 id 解析回图像字节，委派给视觉模型，返回一段文字结论。
于是「生成一张图 → 让 agent 描述它到底画了什么」这个闭环第一次成立。

## 两个入口

| 入口 | 谁触发 | 指定图像 | 结果去向 |
| --- | --- | --- | --- |
| `image_vision` 工具 | LLM 自主调用 | `image` 参数（`att_` id），省略则看最近一张图 | 作为工具结果进入模型上下文 |
| `/img_vision` 命令 | 用户主动敲 | 固定看最近一张图 | 经 `ctx.ui` 通知呈现，**不进消息历史** |

两者共用同一内核，模型选择、降级顺序、失败表现完全一致。

> `/img_vision` 是 pi 扩展命令（`registerCommand`）。这类命令在 agent 进程内本地执行、
> 不产生助手消息，因此结论只能经 `ctx.ui` 呈现——这是 `handler` 返回 `Promise<void>` 决定的。

## 模型从哪来

候选 = `~/.pi/agent/models.json` 中**支持图像输入**（`input` 含 `"image"`）且**凭据可用**的模型。
没有任何静态清单：

```jsonc
{
  "providers": {
    "apiservices": {
      "baseUrl": "https://www.apiservices.top/v1",
      "apiKey": "sk-…",
      "api": "openai-completions",
      "models": [
        { "id": "gpt-5.4", "name": "GPT-5.4", "input": ["text", "image"], … }
      ]
    }
  }
}
```

新增一个支持图像输入的模型，它下次调用就自动出现在候选里，**无需改动任何代码**。

- 有交互界面时：调用时弹层让你选。
- 无交互界面（headless / 自动化）时：不阻塞，按 `PI_WEB_VISION_MODEL`（`provider/modelId`）
  → 候选首个 的顺序降级；一个都没有则安全失败。

主模型**无须**支持图像输入——识别被委派出去了。这正是纯文本 coding 模型也能「看图」的原因。

## 跑起来

```bash
# 可选：无 UI 场景下的默认视觉模型
export PI_WEB_VISION_MODEL="apiservices/gpt-5.4"

pnpm dev   # 然后在 UI 里选择 examples/vision-agent 作为 agent 源
```

试一试：

1. 让它生成一张图：`画一只戴帽子的橘猫`
2. 再让它回看：`看看你刚画的那张图，猫戴的是什么颜色的帽子？`
   → agent 调用 `image_vision`，把 `att_` id 解析回像素，交给视觉模型。
3. 或者直接敲命令：`/img_vision 这张图里有几只动物？`

## 失败是安全的

任何失败都返回结构化结果而非中断会话，原因可区分：
`no_image`、`no_vision_model`、`unknown_model`、`cancelled`、`aborted`、
`model_auth_failed`、`call_failed`、`attachment_not_found`、`not_an_image`、`attachment_unavailable`。

`cancelled` / `aborted` 是用户意图，不会被渲染成故障。

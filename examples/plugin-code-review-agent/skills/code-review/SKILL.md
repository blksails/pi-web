---
name: code-review-skill
description: 触发 code_review 工具对代码片段进行静态检视,返回结构化问题列表并以富卡渲染。
---

# Code Review

## 何时触发

用户要求对一段代码做审查、检视、review、静态分析,或询问"代码有什么问题"时触发本技能。

## 步骤

1. 若用户未提供代码片段,先请求粘贴或描述目标文件 / 选区。
2. 调用 `code_review` 工具,传入 `code`(必填)与 `language`(可选);**不要**用纯文字自行列问题,让工具渲染富卡。
3. 工具返回后,brief 补充说明:每条 finding 的修复方向(可选,简短)。
4. 若用户追问某条 finding 的细节,展开解释并提供修复示例。

## 备注

- `code_review` 工具由同目录 `extensions/code-review.ts` 注册,通过 `pi-web.json` 的 `bindings.tools` 声明。
- 富卡渲染需前端加载对应 `.pi/web/dist`(自运行时自动;消费方需安装插件)。

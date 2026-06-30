---
description: 检视粘贴的代码片段,调用 code_review 工具渲染结构化富卡
argument-hint: <code snippet>
---
请对下面这段代码做一次代码检视。

要求:调用 `code_review` 工具(`code` 传入待检视代码,可附 `language`),由工具渲染结构化问题富卡 —— 不要只用文字罗列问题。检视完成后,用一两句话补充每条 finding 的修复方向。

待检视代码:

$ARGUMENTS

---
description: 检视当前 Git 暂存区改动并按严重程度汇总问题
argument-hint: "[额外关注点]"
---
请检视我当前 Git 暂存区的改动:

1. 运行 `git diff --cached` 获取暂存内容(若为空则提示我先 `git add`)。
2. 对每个有实质改动的文件,调用 `code_review` 工具(`code` 传该文件的改动片段、`language` 传其语言)以富卡呈现问题。
3. 汇总:按严重程度(高→低)排列所有 finding,并指出哪些应在提交前修复。

额外关注点(若有):$ARGUMENTS

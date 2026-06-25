---
name: pi-team
description: 在 Claude Code 里把 pi-web 的多个开发任务编排成一支「agent 团队」——你(Claude Code)就是主控台,每个 Ghostty tab 是一个在独立 git worktree 里执行的 Claude agent。当用户想「并行跑多个任务/开一队 agents/用 tab 管理多个任务/主控台编排/把这些任务分给多个 agent 去做」时使用。底层用 ghostty-ctl(gtmux)管理 tab + scripts/pi-team/pi-team 管队列与 worktree。仅限 macOS + Ghostty。
---

# pi-team —— Claude Code 作主控台,多 tab 多 agent 编排

## 角色模型
- **主控台 = 你(Claude Code 本会话)**。不要起独立的后台守护进程;调度循环由你在对话里驱动。
- **每个 Ghostty tab = 一个在执行的 Claude agent**,跑在自己的 git worktree(分支 `pi-team/<id>`)里,互不冲突。
- 你的职责:收集任务 → 入队 → 派发(每任务一个 agent tab)→ 抽查进度并向用户简报 → 完成后释放名额、补位 → 收尾。

## 工具(经 Bash 调用)
- `scripts/pi-team/pi-team` —— 队列 + worktree 隔离 + 用 gtmux 派发 agent tab 的原语集。
- `gtmux`(ghostty-ctl 插件)—— 需要时直接读屏/控制某个 tab(`gtmux read <selector>` 等)。
- 二者都会自动兜底解析已安装的 gtmux 路径,本会话即可用。

设一个简写:`P=scripts/pi-team/pi-team`(在 pi-web 仓库根运行)。

## 编排协议(你每轮要做的)

1. **入队**:把用户给的每个任务 `P add "<prompt>" --title "<短标题>"`。标题要短而可辨(显示在 tab 和状态表)。任务多时一次性全 add。
2. **派发**:`P start --max N`(默认并发 2–3,按用户意愿)。每个任务会:建 worktree → `gtmux claim` 一个 tab → 在 worktree 里启动交互式 `claude` 并预载 prompt、自动提交首条。
3. **监控并简报**:用 `P ls` 看状态表;对 running 的任务用 `P peek <id> -n 20` 或 `gtmux read <selector>` 抽查。**以主控台口吻给用户紧凑简报**(每个任务一行:状态/标题/分支/一句话进展),**不要把 tab 原始输出整段贴出来**。
4. **推进队列**:某任务做完(用户确认,或你 peek 判断已完成)→ `P done <id>` 释放并发名额 → 再 `P start` 让排队任务补位。
5. **介入**:需要给某 agent 追加指令时 `P send <id> "<text>"`;要把某 tab 切到前台让用户接管时 `P attach <id>`。
6. **收尾**:任务分支验收/合并后 `P rm <id>`(关 tab + 删 worktree + 删分支);批量清理已完成的用 `P clean`。

## 简报格式(你向用户输出的样子)
```
pi-team · 3 running / 2 queued / 1 done
  [a1] ▸ 清空按钮      pi-team/…a1   正在改 prompt-input.tsx,已加按钮、写测试中
  [b2] ▸ 暗色对比度    pi-team/…b2   在调 web-search-toggle 配色
  [c3] ▸ e2e 修复      pi-team/…c3   跑 e2e 中,2 用例待过
  [d4] · queued        —             等名额
```

## 命令速查
`P add "<prompt>" [--title T] [--base ref]` · `P ls` · `P start [--max N] [--no-send]` ·
`P peek <id> [-n N]` · `P send <id> "<text>"` · `P attach <id>` · `P done <id>` ·
`P rm <id> [--keep-branch]` · `P clean`

## 约定与注意
- **并发名额靠 `done` 释放**:交互式 agent 无法自动判完成。你 peek 判断某任务完成或用户说完成后,`P done <id>` 再 `P start` 补位。(若用户要全自动,可改用 headless 执行体:`PI_TEAM_CMD='claude -p --dangerously-skip-permissions'`,进程退出即完成,便于自动检测。)
- **隔离**:每任务独立 worktree(仓库外 `../.pi-team-worktrees/`),并发改代码不冲突;状态在 `.pi-team/`(已 gitignore)。
- **焦点**:tab 在当前 front 窗口新开。建议让用户指定一个「团队窗口」,你在那个窗口语境下派发;`attach`/新窗口等抢焦点操作只由你(主控台)发起。
- **base 分支**:默认从 `main` 切;跨特性分支时用 `--base <ref>`。
- 详细机制见 `scripts/pi-team/README.md`;tab 控制底层见 ghostty-ctl 的 `gtmux`。

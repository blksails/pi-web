# pi-team — pi-web 开发主控台

任务队列 + git worktree 隔离 + gtmux 多 tab 编排。把开发任务压入队列,每个任务在**独立 worktree** 里、用 **gtmux 领一个 Ghostty tab** 启动一个**交互式 Claude 会话**(预载 prompt,可随时介入)。

依赖:`gtmux`(ghostty-ctl 插件)、`git`、macOS + Ghostty。

## 快速上手

```sh
P=scripts/pi-team/pi-team

# 1) 压任务入队
$P add "给 prompt-input 加清空按钮" --title "清空按钮"
$P add "修 web-search-toggle 暗色对比度" --title "暗色对比度"

# 2) 开主控台(自动派发到并发上限 + 实时刷新)
$P console --max 3            # 加 --peek 每行附带 tab 最后一行输出

# —— 或一次性派发,不进 loop ——
$P start --max 3
```

主控台里每个任务:建分支 `pi-team/<id>` 的 worktree(在仓库外 `../.pi-team-worktrees/<id>`)→ gtmux claim 一个 tab → `cd <worktree> && claude "<prompt>"`,5s 后自动回车提交首条(`--no-send` 关闭)。

## 命令

| 命令 | 作用 |
|---|---|
| `add "<prompt>" [--title T] [--base ref]` | 入队(base 默认 `main`) |
| `ls` / `status` | 状态表(pending/running/done/failed) |
| `start [--max N] [--no-send]` | 派发到并发上限 |
| `console [--max N] [--interval S] [--peek]` | 实时主控台(自动派发) |
| `attach <id>` | 把该任务 tab 切到前台 |
| `peek <id> [-n N]` | 读该 tab 最后 N 行 |
| `send <id> "<text>"` | 往该 tab 追加输入(交互介入) |
| `done <id>` | 标记完成,释放并发名额(保留 tab/worktree) |
| `rm <id> [--keep-branch] [--keep-tab]` | 拆除:关 tab + 删 worktree + 删分支 |
| `clean` | 拆除所有 done/failed 任务 |

## 典型流程

```sh
$P add "任务A"; $P add "任务B"; $P add "任务C"
$P console --max 2            # A、B 先跑,C 排队;某个 done 后 C 自动补位
# 在某个 tab 里 Claude 干完活、提交到自己的 pi-team/<id> 分支后:
$P done <id>                 # 释放名额
# 验收满意后合并分支,再:
$P rm <id>                   # 关 tab + 删 worktree + 删分支
```

## 约定与注意

- **并发名额靠 `done` 释放**:交互式 Claude 没法自动判完成,所以跑完一个任务你 `done <id>`,主控台才会把排队任务补上。
- **焦点**:`claim` 在**当前 front 窗口**新开 tab。建议在你想当「团队窗口」的那个 Ghostty 窗口里跑 console。`attach`/`new-window` 等抢焦点操作只由主控台发起。
- **worktree 在仓库外**(`../.pi-team-worktrees/`),不污染主工作树;状态在 `.pi-team/`(已 gitignore)。
- **换执行体**:`PI_TEAM_CMD=...` 可把 `claude` 换成别的 runner(如 `claude --model ...`、或测试用的回显命令)。
- **base 分支**:默认从 `main` 切;`--base <ref>` 可改(如从当前特性分支切)。

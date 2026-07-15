# 日常工作业务（daily-work-agent）

面向日常办公与业务操作的 agent source：号码生成、文件拷贝审核、批量核对与工作简报。

## 它提供什么

| 能力 | 形态 | 说明 |
|------|------|------|
| **phonegen** | 工具 `phonegen` + skill | 包装本机 [`/Users/hysios/Projects/phonegen`](file:///Users/hysios/Projects/phonegen)：`python3 main.py`，按省/市/运营商号段生成 |
| **审核文件拷贝** | skill `review-file-copy` | 源/目标清单 diff、体量与抽样校验、风险报告 |
| **批量文件核对** | skill `batch-file-check` | 按清单巡检存在性、命名与门禁 |
| **工作简报** | skill `work-brief` | 日报/周报/待办结构化 |
| **定时任务** | 扩展 `pi-schedule-prompt` + skill | 工具 `schedule_prompt`：相对时间/间隔/cron/一次性提醒 |
| 文件与 shell | 内置 tools allowlist | **仅** `bash` + `fetch` + `schedule_prompt`（禁 read/ls/glob/write/edit/patch，防绕过 OS 沙盒） |

## 目录

```
daily-work-agent/
├── index.ts                 # AgentDefinition 入口
├── package.json             # pi-web 展示元数据（标题：日常工作业务）
├── tools/
│   └── phonegen.ts          # 包装真实 CLI（PHONEGEN_ROOT）
├── .pi/
│   ├── sandbox.json         # 项目沙盒：cwd + phonegen
│   └── skills/
│       ├── phonegen/
│       ├── review-file-copy/
│       ├── batch-file-check/
│       ├── work-brief/
│       └── schedule-prompt/
└── README.md
```

## 定时扩展（pi-schedule-prompt）

依赖本机已安装：

```bash
pi install npm:pi-schedule-prompt
# 或 settings.json packages 含 "npm:pi-schedule-prompt@0.4.1"
```

本 agent 会：

1. 在 `extensions` 里显式加载  
   `$PI_CODING_AGENT_DIR/npm/node_modules/pi-schedule-prompt/src/index.ts`  
   （找不到则跳过扩展路径；请确认包已安装）
2. 在 `tools` **白名单**加入 `schedule_prompt`  
   （只开内置名、不写扩展工具名时，定时工具不会出现）

试用：

- 「30 分钟后提醒我检查拷贝任务」
- 「每小时汇总一次待办」
- 「列出当前定时任务」

## 运行

```bash
# 仓库根
pi-web ./examples/daily-work-agent

# 或开发态把 source 指到本目录
pnpm dev
# 前端选源 → examples/daily-work-agent
```

> 项目级 `.pi/skills` 受 **project trust** 门控。若斜杠面板看不到 `/skill:*` 或模型不按 skill 行事，检查该 source 目录是否已被信任（见产品文档「扩展与 skills · 信任策略」）。

## phonegen 依赖

真实生成器不在本仓库内，而在：

```text
/Users/hysios/Projects/phonegen
  main.py
  phone.dic / phone1.dic
  generated/          # 历史大批量输出可参考命名
```

覆盖路径：

```bash
PHONEGEN_ROOT=/path/to/phonegen pi-web ./examples/daily-work-agent
```

等价手工命令示例：

```bash
cd /Users/hysios/Projects/phonegen
python3 main.py -p 湖南 --op 移动 -n 100 -m random
python3 main.py -p 上海 --op 联通 -o generated/上海_联通.txt -n 10000
```

## 试用话术

- 「用 phonegen 随机生成 50 个湖南移动号码」
- 「上海联通顺序生成 1 万个，写到 generated/上海_联通_试跑.txt」
- 「审核把 `/data/src` 拷到 `/data/dst` 是否完整」
- 「按下面清单核对文件是否都在 `./exports`：…」
- 「根据这些要点写今日工作简报：…」
- 「20 分钟后提醒我核对导出清单」
- 「每小时提醒我看一下生成进度」

## 沙盒（pi-sandbox）

本 source 自带项目级策略 `.pi/sandbox.json`（与全局 `~/.pi/agent/sandbox.json` 深合并，项目优先）：

| 放行 | 拒绝（默认） |
|------|----------------|
| `.`（本 agent cwd） | `/Users`、`/home` 树（`denyRead`；未在 allow 的路径 headless 下硬拦） |
| `/Users/hysios/Projects/phonegen` | 写 `.env` / `*.pem` / `*.key` 等 |
| `/tmp`（写）、本机 `python3`（读，供 phonegen CLI） | 网络：`allowedDomains` 为空 = bash 侧默认不出网 |

注意：本 agent **只放行 `bash` 做文件/目录操作**（pi-sandbox OS 沙盒）。已禁用 `read` / `ls` / `glob` / `write` / `edit` / `patch`（Node 直访 FS，不经 OS 沙盒）。测拦截：`bash` → `ls /Users`。

改策略后请**新开会话**（旧会话内存 grant 不继承新文件）。

## 安全说明

- 不落盘时工具限制 count≤200，且 sequence 全量必须带 `output`，防止误触海量生成。
- 拷贝审核默认**只读**；补拷/删除须用户明确确认后再执行。
- 用途须符合业务合规；拒绝对骚扰/欺诈场景出号。

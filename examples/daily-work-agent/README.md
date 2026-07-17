# 日常工作业务（daily-work-agent）

面向日常办公与经 **pi-gateway** 的 IM 通道：号码生成、**sendaction 手动回传**、**域名审核文件上传**、定时、企微、长期记忆，以及 **主动认知 / 工作循环** 人格。

> **不是** `builtin:default-agent`。通用编码/问答用 default-agent；本 source 专供日常工作与通道场景。

## 它提供什么

| 能力 | 形态 | 说明 |
|------|------|------|
| **系统提示** | `prompts/system-prompt.md` | 通道纪律、env/scene/people 认知、工作循环、无 todo tools |
| **phonegen** | 工具 `phonegen` + skill | 包装本机 phonegen CLI，按省/市/运营商号段生成 |
| **手动回传** | 工具 `sendaction` + skill | 包装本机 hnhuaxi `sendaction`（腾讯广告 click_id 转化回传） |
| **域名审核上传** | 工具 `upload_domain_review` + skill | 解压压缩包 → `scp -r` 到 `ab1:~/ablink/public` |
| **定时任务** | 扩展 `pi-schedule-prompt` + skill | 工具 `schedule_prompt`：相对时间/间隔/cron/一次性提醒 |
| **长期记忆** | 扩展 `memoryExtension` | `memory_*`；默认 global；tags 约定见 system-prompt |
| **企业微信** | wecom extension | `wecom_send` / file / menu / binding / health |
| 文件与 shell | tools allowlist | **仅** `bash` + `fetch` + 扩展工具（禁 read/ls/glob/write/edit/patch） |

## 目录

```
daily-work-agent/
├── index.ts                 # AgentDefinition 入口（加载 prompts/system-prompt.md）
├── prompts/
│   └── system-prompt.md     # 人格与纪律（权威）
├── package.json
├── tools/
│   ├── phonegen.ts
│   ├── sendaction.ts              # 腾讯广告手动回传 CLI 包装
│   └── upload-domain-review.ts    # 域名审核包解压 + scp ab1
├── .pi/
│   ├── sandbox.json
│   └── skills/
│       ├── sendaction/
│       └── upload-domain-review/
└── README.md
```

## 给 pi-gateway 用

将 `upstream.agentSource`（及通道 `opts.agentSource`）设为**本目录绝对路径**，例如 monorepo 内：

```json
"agentSource": "/path/to/pi-web/examples/daily-work-agent"
```

索引说明见 pi-gateway：`prompts/builtin-channel-agent.md`。

## 长期记忆（memoryExtension）

进程内装载 `@blksails/pi-web-tool-kit/runtime` 的 `memoryExtension`，并在 `tools` 白名单放行：

- `memory_write` / `memory_read` / `memory_list` / `memory_search` / `memory_delete`

| 环境变量 | 默认 | 说明 |
|----------|------|------|
| `PI_WEB_MEMORY_BACKEND` | `file` | `file` 或 `supabase` |
| `PI_WEB_MEMORY_DIR` | `~/.pi/agent/memory` | 本地记忆根目录 |
| `PI_WEB_MEMORY_SUPABASE_URL` / `_KEY` | — | 云上后端 |
| `PI_WEB_MEMORY_AGENT_SOURCE_ID` | — | 可选；`scope=agent-source` 时默认 source id |

试用：

- 「记住：周报用简洁中文，代码注释用英文」
- 「我之前约定的汇报格式是什么？」
- 「列出和 prefs 相关的记忆」

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

## sendaction 手动回传

真实 CLI 不在本仓库内，而在：

```text
/Users/hysios/Projects/hnhuaxi/utils/sendaction
  main.go
  send.sh / send3.sh
  .env / .env.<accountId>   # GDT_ACCESS_TOKEN、ACCOUNT_ID…
```

覆盖路径：

```bash
SENDACTION_ROOT=/path/to/sendaction pi-web ./examples/daily-work-agent
```

| mode | 说明 |
|------|------|
| **2**（默认） | Web GET `tracking.e.qq.com/conv/web`，需 `click_id`；**默认 link=`https://pub.wdshquan.top`** |
| **3** | Web POST `/conv`，可选 `action_params` JSON；link 同上 |
| 0 / 1 / 4 / 5 | callback / Marketing API / 微信 / API v3 |

工具行为：

1. **预览**：不设 `confirm` → 只打印将执行的 `go run . …`，不真正回传。
2. **执行**：用户确认后 `confirm: true`。
3. **批量**：`click_ids: ["…", "…"]` 串行。
4. **切账号**：`list_accounts: true` 或 `env_file: ".env.74"`。
5. **脱敏**：stdout/stderr 中的 token 会被 redact。

等价手工命令：

```bash
cd /Users/hysios/Projects/hnhuaxi/utils/sendaction
go run . -mode 2 -click_id=wx0vuf3x5fzpc2ey00 -link=https://pub.wdshquan.top -action_type=RESERVATION
# 或
./send.sh "$CLICK_ID" https://pub.wdshquan.top RESERVATION
```

覆盖默认 link：

```bash
SENDACTION_LINK=https://other.example.com pi-web ./examples/daily-work-agent
```

> 与 BlackSail 控制台「手动回传」workflow 不同：本工具是本机 CLI 直连腾讯，不写 `pushes` 表、不经 Temporal。

## 上传域名审核文件（upload_domain_review）

收到压缩包后：

1. 解压（zip / tar / tar.gz / …）
2. `scp -r <文件夹> ab1:~/ablink/public`

| 项 | 默认 |
|----|------|
| 远端 | `ab1:~/ablink/public` |
| 覆盖远端 | env `ABLINK_SCP_REMOTE` |
| 安全闸 | 须 `confirm: true` 才 scp |
| SSH | 本机 `~/.ssh/config` 的 `Host ab1` |

等价手工：

```bash
unzip -o review.zip -d /tmp/review
scp -r /tmp/review/site ab1:~/ablink/public
```

## 试用话术

- 「用 phonegen 随机生成 50 个湖南移动号码」
- 「上海联通顺序生成 1 万个，写到 generated/上海_联通_试跑.txt」
- 「把 click_id=wx0… 手动回传一下（先预览，用默认 link）」
- 「确认回传上面那条」
- 「列出 sendaction 可用账号 env」
- 「把这份域名审核压缩包解压并上传到 ab1 public（先预览）」
- 「确认上传域名审核文件」
- 「20 分钟后提醒我核对导出清单」
- 「每小时提醒我看一下生成进度」

## 沙盒（pi-sandbox）

本 source 自带项目级策略 `.pi/sandbox.json`（与全局 `~/.pi/agent/sandbox.json` 深合并，**项目优先**；数组字段整体覆盖，不追加）。

### 文件系统

| 类别 | 路径 | 用途 |
|------|------|------|
| 读/写 | `.` | agent 工作目录 |
| 读/写 | `/Users/hysios/Projects/phonegen` | phonegen 号段与输出 |
| **读** | `/Users/hysios/Projects/hnhuaxi/utils/sendaction` | sendaction 源码 / `.env*`（只读） |
| **读** | `/opt/homebrew/bin/go`、`/opt/homebrew/Cellar/go`、`/usr/local/go` | Go 工具链（`go run`） |
| **读** | `/Users/hysios/go` | `GOPATH` / 已缓存 module |
| **读/写** | `/Users/hysios/Library/Caches/go-build` | `GOCACHE`（编译缓存） |
| **读/写** | `/Users/hysios/go/pkg/mod` | 缺包时下载 module（可选写） |
| **读/写** | `/tmp`、`/private/tmp`、`/var/folders` | macOS `TMPDIR` + go / 解压临时产物 |
| 读 | `/opt/homebrew/bin/python3` | phonegen CLI |
| **读** | `/Users/hysios/.ssh`、`/usr/bin/scp`、`ssh`、`unzip`、`tar` | 域名审核 scp + 解压 |
| **写** | `/Users/hysios/.ssh/known_hosts` | 首次连接 ab1 写 host key |
| **硬拒写** | `.env`、`.env.*`、`*.pem` / `*.key` / `*.crt` | 防 bash 改密钥（含 sendaction 目录） |
| 默认拒读 | `/Users`、`/home` | 未列入 allowRead 的路径 headless 下拦截 |

### 网络（`allowedDomains`）

| 域名 | 用途 |
|------|------|
| `tracking.e.qq.com` | Web 转化回传（mode 2/3/4） |
| `api.e.qq.com` | Marketing API（mode 1/5） |
| `api.weixin.qq.com` | 微信侧（若扩展） |
| `proxy.golang.org` / `sum.golang.org` / `storage.googleapis.com` | `go run` 拉依赖（缓存命中时可不出网） |
| `106.14.250.218` | Host ab1（域名审核 scp） |

> 留空 `allowedDomains` = bash 侧默认**零出网**。本 source 仅白名单上述域，不设 `"*"`。

注意：pi-sandbox **OS 级沙盒主要约束 `bash`**。`sendaction` / `phonegen` 自定义工具若在 Node 内 `spawn`，不经 sandbox-exec；通过 bash 手跑等价命令时上述策略生效。已禁用 `read` / `ls` / `glob` / `write` / `edit` / `patch`。

改策略后请**新开会话**（旧会话内存 grant 不继承新文件）。

## 安全说明

- 不落盘时工具限制 count≤200，且 sequence 全量必须带 `output`，防止误触海量生成。
- 用途须符合业务合规；拒绝对骚扰/欺诈场景出号。

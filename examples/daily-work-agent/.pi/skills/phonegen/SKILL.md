---
name: phonegen
description: 调用本机 /Users/hysios/Projects/phonegen 按省/市/运营商号段生成手机号。用户提到 phonegen、号码生成、按省份运营商出号、号段生成时使用。
---

# phonegen · 号码生成（真实 CLI）

## 后端位置

- 项目根：`/Users/hysios/Projects/phonegen`（可用 env `PHONEGEN_ROOT` 覆盖）
- 入口：`python3 main.py`
- 号段：`phone.dic` / `phone1.dic`（CSV：segment,province,city,operator）
- Agent 工具：`phonegen`（包装上述 CLI，cwd 固定为项目根）

## 何时触发

- phonegen / 号码生成 / 按省市区运营商出号
- 「湖南移动」「上海联通随机 100 个」等

## 步骤

1. 确认筛选：`province`（省）、可选 `city`、可选 `operator`（移动/联通/电信）。
2. 确认数量与模式：
   - **小样本预览**（≤200）：可不设 `output`，用 `mode: random` 或带 `count` 的 sequence。
   - **大批量**：必须设 `output` 落盘；可加 `limit` 分片、`shuffle` / `shuffleChunks`。
3. **调用工具 `phonegen`**，不要手写号码，也不要用假号段瞎编。
4. 把工具返回的 stdout / 文件路径如实汇报；若「未找到符合条件的号段」，帮用户改省市区或运营商措辞（须与 dic 中字段完全一致）。
5. 若需查看落盘结果，用 **`bash`**（`head`/`wc`），不要用 `read`/`glob` 工具。

## 工具参数 ↔ CLI

| 工具字段 | CLI | 说明 |
|----------|-----|------|
| province | `-p` | 如 湖南、上海 |
| city | `-c` | 如 合肥、广州 |
| operator | `--op` | 移动 / 联通 / 电信 |
| count | `-n` | 数量 |
| mode | `-m` | `random` \| `sequence`（默认 sequence） |
| shuffle | `-s` | 全局乱序 |
| shuffleChunks | `--shuffle-chunks` | 分片内乱序 |
| output | `-o` | 输出文件（相对路径相对 phonegen 根） |
| limit | `-l` | 单文件最大行数 |
| files | `-f` | 号段文件列表，默认 phone.dic |

## 示例

- 湖南移动随机 100 个：
  `phonegen({ province: "湖南", operator: "移动", count: 100, mode: "random" })`
- 上海联通写入文件：
  `phonegen({ province: "上海", operator: "联通", mode: "sequence", count: 10000, output: "generated/上海_联通_试跑.txt" })`
- 合肥移动（城市）：
  `phonegen({ province: "安徽", city: "合肥", operator: "移动", count: 50, mode: "random" })`

## 纪律

- sequence 且不设 count 时工具会要求 `output`，避免全量刷屏。
- 不落盘时 count 上限 200；更大必须 `output`。
- 号段数据与生成逻辑以 phonegen 仓库为准；本 skill 只描述如何正确调用。
- 用途限于业务允许的号段作业；若用户意图涉及骚扰/欺诈，拒绝执行。

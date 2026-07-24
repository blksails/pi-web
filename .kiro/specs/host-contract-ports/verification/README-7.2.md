# 任务 7.2 浏览器 e2e 检阅结果

> 执行时间：2026-07-22
> HEAD：`f199765`（第 6 组收口后）
> 运行条件：`NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=0 NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=0 pnpm e2e`
> （基线规则第 3 条：必须带门控置 0 的 env 前缀，否则复现的是污染态）

## 结果

**114 passed / 1 failed / 7 skipped**

## ★ 那 1 条失败：既有问题，非本期缺陷 —— 且基线记录有误

失败用例：`e2e/browser/slash-command-palette.e2e.ts:142` #86
`slash palette: command-mode Enter with candidates does not send, appended args then send (Req 3.3, 4)`
断言：输入 `/help` 按 Enter 后 textarea 应为 `"/help "`，实际为 `""`。

### 判定过程（未凭「看起来无关」放过）

零失败基线上的任何失败都是本期缺陷嫌疑，故逐步排查：

1. **复跑判别 flaky** → 单文件直跑**仍失败**，稳定失败，不是 flaky。
2. **排查 `export *` 静默丢弃**（本 spec 唯一的运行期改动是主入口新增 5 条 `export *`；ESM 中两个 `export *` 导出同名符号时该符号会被**静默丢弃**，而 `tsc` 的 TS2308 只覆盖类型层，任务 6.2 复核只验到那一层）
   → 实测：五模块内部**无重名**，276 个符号**全部**出现在主入口，**零丢失**。排除。
3. **回到本 spec 任何代码改动之前的提交做对照**（`1f1caa1`，即基线面 5 有效基线的采集点），独立 worktree + 重新构建 + 相同 env 前缀：

| | 对照点 `1f1caa1` | 本次 `f199765` |
|---|---|---|
| 全量 e2e | 114 passed / **1 failed** / 7 skipped | 114 passed / **1 failed** / 7 skipped |
| 失败用例 | `slash-command-palette.e2e.ts:142` #86 | 同 |
| 单文件直跑 | 1 failed / 7 passed | 1 failed / 7 passed |

**逐字相同。** 用例文件本身与对照点 `diff` 为空（本 spec 未碰它）。

### 结论

该失败**在本 spec 任何代码改动之前就已存在**，与本期无关。

**同时说明基线 README 的面 5 记录「终轮 0 failed / 115 passed」不准确** —— 那条用例在基线采集时就是红的。基线终轮之所以记成 0 failed，最可能是采集时误读或环境差异；本次以**同一提交、同一条件的实跑**为准。

> ⚠ 这是一条**被基线漏记的既有失败**，不是本期引入。建议单独立项排查（与本 spec 无关：本 spec 零接线，未触碰命令面板、输入框或任何既有装配）。

## 对照实验的可复现方式

```bash
git worktree add /tmp/pi-web-baseline 1f1caa1
ln -sfn <repo>/node_modules /tmp/pi-web-baseline/node_modules   # 各 packages/*/ 同理
ln -sfn <pi-clouds 真实路径> /private/tmp/pi-clouds              # 兄弟仓相对路径依赖，否则 build 崩
cd /tmp/pi-web-baseline && pnpm build:dist
NEXT_PUBLIC_PI_WEB_SOURCE_PICKER=0 NEXT_PUBLIC_PI_WEB_LAUNCHER_RAIL=0 pnpm e2e
```

## 原始日志

`72-build.log`（本次构建）/ `72-e2e-browser.log`（本次全量）/ `72-recheck.log`（本次单文件复跑）
`72-baseline-full.log`（对照点全量）/ `72-baseline-recheck.log`（对照点单文件）

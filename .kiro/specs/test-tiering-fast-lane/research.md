# Research Log — test-tiering-fast-lane

> 发现类型：**Light Discovery（Extension）**。本特性改造既有测试运行面，不引入新技术栈。
> 全部结论来自本机实测，命令与数字逐条记录，便于复核者复跑。
> 环境：worktree `.claude/worktrees/core-extraction`，基于 main `6b638622`，vitest 2.1.9，Node 22.22.0。

---

## 1. 发现范围

单一核心未知：**「fast 档 < 10 秒」是否可达**，以及**分档判据如何机械判定而不误报**。
其余（文件归位、脚本入口、e2e 摘除）是确定性工作，无需研究。

---

## 2. 基线与集合划分

### 2.1 机械划分

判据：真实 spawn/fork ∪ `mkdtemp` ∪ pi SDK 值导入 ∪ `test/integration/` 目录 ∪ `.e2e`/`.local` 后缀。

```
all=276  heavy=78  pure=198
```

初筛 `spawn` 曾得 29 个文件，**逐条核实后剔除 4 个误报**：
`ai-gateway/config.test.ts`、`ai-gateway/key-resolver.test.ts`、`runner/option-mapper-mcp.test.ts`
（注释里出现 "spawn" 字样）与 `rpc-channel/sandbox-ws-transport.test.ts`
（`vi.fn()` 命名为 `spawned` 的 mock）。真实 spawn 子进程的是 **25 个**。

### 2.2 it 档 / e2e 档的分界

heavy 集合中按 env 门控的 4 个文件，逐个查了门控**范围**：

| 文件 | 门控 | 范围 | 归档 |
|---|---|---|---|
| `rpc-channel/e2b-transport.local-sandbox.test.ts` | `PI_WEB_E2B_LOCAL` | `describe.skipIf` 覆盖**整文件** | e2e |
| `rpc-channel/sandbox-ws-transport.local.test.ts` | `PI_WEB_E2B_LOCAL` | 整文件 | e2e |
| `rpc-channel/sandbox-ws-transport.pi.local.test.ts` | `PI_WEB_E2B_PI_LOCAL` + `DASHSCOPE_API_KEY` | 整文件 | e2e |
| `runner/runner.e2e.test.ts` | `ANTHROPIC_API_KEY` | **仅一个 describe 块**（第 247 行），其余真跑本地子进程 | **it** |

★ 结论：`runner.e2e.test.ts` 尽管挂着 `.e2e` 后缀，**不属 e2e 档** —— 它无凭据时只跳过一个块，
其余部分是标准的本地子进程集成测试。仅看后缀会把它误分到 e2e，正是本 spec 要消灭的那种失真。

**最终分档**：fast 198 / it 75 / e2e 3，合计 276 ✓

### 2.3 基线取证 —— **基线本身不稳定**

在 main `6b638622` 上对 `packages/server` 连跑全量，结果**不一致**：

| 运行 | 范围 | 结果 | 墙钟 |
|---|---|---|---|
| A | unit 相 | **4 文件 / 5 用例红**，256 passed，7 skipped（267 文件 / 2420 用例） | 115.8 s |
| B | unit 相 | **全绿**，260 passed，7 skipped（267 文件 / 2420 用例） | ~86 s |
| C | integration 相 | **1 文件红**（`attachment-profile-disabled-subprocess.test.ts`：`Timed out waiting for sessionB to become ready`），8 passed | 147.4 s |

★ **同一提交、同一套件、两次运行两种结果。** 这不是噪声，是本 spec 要解决的问题本身：
25 个真实 spawn 子进程的文件留在 unit 档与其余 240 余个文件并发，互相抢占资源，
把会话就绪拖过探针死线 —— 正是 `run-tests.mjs` 注释为 integration 相描述过、
却从未在 unit 相解决的那个症状。

**对验收的影响**：
- 「不低于基线」**不能**以单次运行的绿为准（会被偶然的绿骗过，也会被偶然的红冤枉）；
  须以**连续两次运行结果一致**为判据。
- 「运行中出现红即为本次引入」这条简化判据**不成立**，必须与留底的基线输出逐项比对。

★ 订正记录：本文档与四份 brief 早期写的「基线 267 文件 / 2426 用例 / 85.6 s 全绿」**是错的** ——
那个数字取自 `feat/aigc-canvas-panes-migration` 分支（当时另有 3 红），并非 main。
main 的真实用例总数是 **2420**，且如上表所示不稳定。

### 2.4 汇总行算术校验

vitest 的 worker 崩溃会被算成「0 failed」，故每次读数都核对 `passed + failed + skipped == 总数`：

| 运行 | 文件 | 用例 |
|---|---|---|
| A | 4+256+7 = 267 ✓ | 5+2398+17 = 2420 ✓ |
| B | 260+7 = 267 ✓ | 2403+17 = 2420 ✓ |
| C | 1+8 = 9 ✓ | 1+31+1 = 33 ✓ |
| fast 候选（隔离态） | 195+3 = 198 ✓ | 1795+8 = 1803 ✓ |
| fast 相 1 | 190+3 = 193 ✓ | 1764+8 = 1772 ✓ |
| fast 相 2 | 5 ✓ | 31 ✓ |

相 1 + 相 2 = 193+5 = 198 文件、1772+31 = 1803 用例，与隔离态全量跑**逐位吻合** ——
证明分相没有漏跑任何文件。

---

## 3. 关键实测：fast 档耗时

同一 198 文件集合，四种配置逐一实测：

| # | 配置 | 墙钟 | collect | prepare | tests | 结果 |
|---|---|---|---|---|---|---|
| 0 | 现状（forks + isolate） | **20.46 s** | 93.07 s | 23.11 s | 14.09 s | 198 文件 / 1803 用例全绿 |
| 1 | `--pool=threads` | 16.34 s | 79.01 s | 19.12 s | 11.79 s | 全绿 |
| 2 | `threads` + `--no-isolate` | **4.37 s** | 21.80 s | 0.83 s | 6.78 s | **2 文件 / 4 用例红** |
| 3 | 方案：193 无 mock（`no-isolate`）+ 5 有 mock（isolate） | **4.37 + 0.86 s** | — | — | — | 193+5 全绿 |

**读数**：瓶颈是 `collect`（模块图重复加载，93 s）与 `prepare`（worker 启动，23 s），
`tests`（断言执行）只占 14 s。这解释了为什么"少跑几个测试"帮助有限，而**关隔离**（模块图在
worker 内复用）能把墙钟砍掉 4.7 倍。

**配置 2 的 4 个红**（这是关隔离的代价，必须精确记录）：
- `test/config-domain/registry-validator-errors.test.ts`（2 例）
- `test/config/config-codec.error-partition.test.ts`（2 例）

根因：两者都用 `vi.mock(..., importOriginal)` 覆盖模块导出。关隔离后同一 worker 内模块注册表
共享，若别的测试文件已先加载过该模块，mock 不再生效。这是 vitest 的既定语义，不是缺陷。

**受影响面**：pure 集合 198 个文件中，用 `vi.mock` 的只有 **5 个**：
```
test/config-domain/registry-validator-errors.test.ts
test/config/config-codec.error-partition.test.ts
test/rpc-channel/e2b-transport.test.ts
test/rpc-channel/sandbox-ws-transport.test.ts
test/session-list/session-list-store-retry.test.ts
```

### 3.1 为什么不改写这 5 个测试

改用依赖注入替代 `vi.mock` 可以让它们在关隔离下工作，但那是**改写测试内容**，
违反 R7.3。故设计取「按需隔离」的分相方案，而非改测试。

### 3.2 一条容易被忽略的细节

`rpc-channel/e2b-transport.test.ts` 与 `sandbox-ws-transport.test.ts` 用的是
`vi.mock("e2b", factory)` —— **工厂式、不带 `importOriginal`**，故真实 e2b SDK **从不加载**。
它们是行为意义上的 fast 测试。任何"见到 `e2b` 字样就判红"的守卫都会误伤它们。

---

## 4. 关键实测：守卫判据

### 4.1 传递依赖扫描 —— **不可用**

写脚本从每个 fast 候选文件出发，沿相对 import 递归走模块图，检查是否触达
`e2b` / `pg` / `@modelcontextprotocol/sdk` / pi SDK / `node:child_process` / `registry-client`：

```
传递扫描:pure 集合中命中禁用依赖的文件数 = 116 / 198   （耗时 0.77 s）
```

**59% 误报**。根因是 barrel：`src/agent-source/index.ts`、`src/rpc-channel/index.ts` 等把整个
模块图拉进来，于是几乎每个经 barrel 导入的测试都"传递依赖" e2b 与 `child_process` ——
尽管运行期那些代码路径从不执行。

典型命中链：
```
agent-source-list/agent-sources-routes.test.ts
    node:child_process  ←src/agent-source/git-clone.ts
    e2b                 ←src/rpc-channel/e2b-transport.ts
```

★ 这条否定了「静态传递扫描」这个最直觉的守卫方案。记在此处，以免后续有人重新提出。
（顺带：它也是内核提取波次要解决的问题的一个侧影 —— barrel 让依赖边界不可见。
但**本 spec 不修 barrel**，那属 `kernel-boundary-decoupling` 与三个提取 spec。）

### 4.2 运行期哨兵 —— 三次尝试才找到可用手段

★ **本节初稿是错的,已推翻重写。** 初稿写「运行期哨兵可用、193 文件零违规零误报」,
证据只是一次跑绿。后续实测证明那次哨兵**根本没装上**,「零违规」毫无信息量。
这条传播链值得记住:**一个没装上的哨兵报出的绿,和真的没有违规,在输出里长得一模一样。**

| # | 手段 | 结果 |
|---|---|---|
| 1 | 改写 `child_process` 命名空间导出 | ✗ **拦不住 ESM 具名导入**。实测 `nsWorked === false` —— `import { spawn } from "node:child_process"` 在链接期绑定到原函数,事后改命名空间无效;而 `src/rpc-channel/pi-rpc-process.ts` 正是这么写的 |
| 2 | `diagnostics_channel("child_process")` | △ 与导入写法无关,异步 `spawn` 可靠触发(实测 hits=1);但 `spawnSync` / `execFileSync` **完全不发**(hits=0),覆盖不全 |
| 3 | **vite `resolve.alias` 把 `node:child_process` 指向守卫模块** | ✓ 采用。导入不报错、调用才抛错,**覆盖任意导入写法 × 同步与异步** |

另有一个把前两次都骗过去的配置陷阱:

★ **`vitest.workspace.ts` 存在时,`vitest -c <config>` 的根级 `test.setupFiles` 被完全忽略。**
实测:哨兵模块里的 `console.log` 出现 **0 次**。`setupFiles` 必须写在 **project** 里才生效。

装对之后的阳性对照(**必须做**,否则重蹈覆辙):

```
FETCH_PATCHED = true        HAS_SUBSCRIBERS = true
x execFileSync("echo")  -> [fast 档违规] child_process.execFileSync("echo")
x spawnSync("echo")     -> [fast 档违规] child_process.spawnSync("echo")
x fetch(127.0.0.1:9)    -> [fast 档违规] fetch("http://127.0.0.1:9/nope")
```

### 4.3 装对之后的真实扫描结果

用可用哨兵扫 204 个 fast 候选:

```
Test Files  16 failed | 185 passed | 3 skipped (204)
     Tests  51 failed | 1811 passed | 9 skipped (1871)
```

**16 个文件 / 51 个用例真的违规** —— 它们经 `src/rpc-channel/pi-rpc-process.ts` 等模块**间接**
起子进程,或对本地测试 HTTP 服务器发请求。静态直接导入分析**原理上**看不见这些,
而传递分析 59% 误报不可用(§4.1)。这批固化为 `RUNTIME_DETECTED_IT` 名册。

★ 这不是判据的漏洞,而是两层守卫分工被实测确认:静态层给早期清晰信号,运行期层兜底。

### 4.4 后续实测补充的两条(design 阶段未知)

- ★ **`isolate` 与 `fileParallelism` 同族,project 级同样被 vitest 2.1.9 忽略。**
  配置里写 `isolate: false` 实测无效(fast 档 12.34s,prepare 12.85s);CLI `--no-isolate`
  才生效(4.03s,prepare 1.16s);`poolOptions.threads.isolate` 也无效(15.74s)。
  由此推出编排约束:`--no-isolate` 是**全局**开关,fast 与 fast-mock 必须**分两次调用**
  (否则 fast-mock 的 `vi.mock` 被一并打坏),再靠**并发**把墙钟压回 6.25s。
- ★ **判据必须剥注释。** 不剥时,判据自身的单测文件会被自己的文档注释打中
  (注释里写了 `from "node:child_process"` 与 `vi.mock(`)。与 §2.1 那 4 个手工 grep 误报同源。

---

## 5. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | fast 档拆成 `fast`（无 mock，`isolate:false`）与 `fast-mock`（用 `vi.mock`，`isolate:true`）两相 | 关隔离带来 4.7 倍加速；5 个 mock 文件按需保留隔离，避免改写测试（R7.3） |
| D2 | 全部档位统一用 `pool:"threads"` | 实测比默认 `forks` 快（16.34 s vs 20.46 s），且 fast 档无子进程需求，不需要进程级隔离 |
| D3 | 守卫分两层：静态**直接**导入扫描 + 运行期哨兵 | 静态传递扫描 59% 误报，不可用；直接扫描给出早期清晰报错，运行期哨兵做真正的行为兜底 |
| D4 | 档位由**文件名后缀**决定，守卫负责校验名实一致 | 后缀驱动 include 模式，零运行期分类成本；名实不符由守卫报红（R3.3） |
| D5 | e2e 档判据 = **整文件**被外部凭据门控 | 部分门控（如 `runner.e2e.test.ts`）仍能在无凭据机器上跑出价值，归 it 档更诚实 |
| D6 | 不修 barrel、不改任何测试断言 | 属 `kernel-boundary-decoupling` 与 R7.3 的边界 |

### 5.1 综合三镜（generalization / build-vs-adopt / simplification）

- **Generalization**：守卫的「名实一致」校验与「行为哨兵」是同一问题的两面（声明 vs 实际），
  但**刻意不合并成一个抽象** —— 它们的失败时机不同（收集期 vs 执行期）、错误信息不同，
  合并只会让报错更难懂。
- **Build vs Adopt**：分档与隔离能力全部由 vitest 原生提供（`projects` / `isolate` / `pool` /
  `setupFiles`），**不自建**任何调度器。唯一自建的是守卫，因为没有现成方案能表达
  「本仓库的 fast 档判据」。
- **Simplification**：放弃了「静态传递扫描」（4.1 已证伪）与「按目录分档」（现状已证会腐化）。
  最终只剩两个机制：后缀 + 两层守卫。

---

## 6. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| `isolate:false` 下未来新增的 `vi.mock` 测试会静默失效或串扰 | 中 | 守卫强制 `vi.mock` 使用者必须带 `.mock.test.ts` 后缀，否则报红 |
| 运行期哨兵可能漏掉真实 fs 写入（本次只拦子进程与 fetch） | 低 | 真实 fs 写入的文件已由 `mkdtemp` 判据归入 it 档；哨兵可后续增补，不阻塞本次 |
| 75 个文件重命名导致 git 历史断裂 | 低 | 一律 `git mv` |
| 重命名撞上正在进行的其它分支 | 中 | 本波次在独立 worktree/分支上做；合并前需与 `feat/aigc-canvas-panes-migration` 对齐 |
| 10 秒阈值在更慢的 CI 机器上不达标 | 中 | 阈值验收以开发机为准；CI 上仅要求全绿，不卡耗时 |

---

## 7. 复跑清单

```bash
cd packages/server
# 集合划分
{ grep -rlE "(child_process|spawnSync|spawn\(|fork\()" test --include="*.test.ts"
  grep -rl "mkdtemp" test --include="*.test.ts"
  grep -rl "@earendil-works/pi-" test --include="*.test.ts"
  find test/integration -name '*.test.ts'
  find test -name '*.e2e.test.ts' -o -name '*.local*.test.ts'; } | sort -u > /tmp/heavy.txt
find test -name '*.test.ts' | sort > /tmp/all.txt
comm -23 /tmp/all.txt /tmp/heavy.txt > /tmp/pure.txt
grep -l "vi\.mock" $(cat /tmp/pure.txt) | sort > /tmp/mocked.txt
comm -23 /tmp/pure.txt /tmp/mocked.txt > /tmp/pure-nomock.txt

# 耗时复测
time pnpm exec vitest run --project unit --pool=threads --no-isolate $(cat /tmp/pure-nomock.txt | tr '\n' ' ')
time pnpm exec vitest run --project unit --pool=threads $(cat /tmp/mocked.txt | tr '\n' ' ')
```

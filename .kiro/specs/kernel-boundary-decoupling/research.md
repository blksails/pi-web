# Research Log — kernel-boundary-decoupling

> 发现类型：**Light Discovery（Extension）**。不引入新技术栈。
> 环境：worktree `.claude/worktrees/core-extraction`，基于 main `2483b2e7`，vitest 2.1.9，Node 22.22.0。
> 上游 `test-tiering-fast-lane` 已完成（commit `8a731c24`），提供 fast 档（暖跑 ~6.8s）作为回归闸门。

---

## 1. 核心发现：brief 的三条方案有两条被实证否定

brief 的方案是在**只看依赖图、没看代码**时写的。逐条打开文件后，三条里有两条方向错了，
另有一条**全新的边**是 brief 写完之后由 main 引入的。

| 边 | brief 的方案 | 实情 | 结论 |
|---|---|---|---|
| `rpc-channel → sandbox-image` | 「把传输侧信息反转为注入」 | 目标是 **120 行纯函数模块**，唯一 import 是 `node:crypto` | ✗ **不需要注入**，是归属放错位置 |
| `runner → auth` | 「egress 模型源改注入」 | 1 处 import 3 个值，目标 183 行、值导入 pi SDK | ✓ 方向正确 |
| **`runner → ai-gateway`** | **brief 里没有这条** | main `f06d4466` 引入，1 处 import 3 个值，目标 201 行 | ⚠ 新增，与上一条同源 |
| `config → http` | 「配置域注册与路由分离，路由工厂上移」 | **5 个路由文件本就住在 `config/` 下** | ✗ 不是「上移工厂」，是这 5 个文件放错了目录 |

---

## 2. 逐条实证

### 2.1 `rpc-channel → sandbox-image` —— 唯一一处，且目标是纯函数

```
rpc-channel/template-resolve.ts:34  import { deriveTemplateName, type SourceIdentityInput }
                                      from "../sandbox-image/template-name.js"
```

`sandbox-image/template-name.ts`：**120 行**，导出 `SourceIdentityInput` / `deriveSlug` /
`deriveImageName` / `deriveTemplateName`，**唯一 import 是 `node:crypto`**。

★ 它根本不是「e2b 镜像烘焙」代码，而是**命名派生的纯逻辑** —— 由构建期（sandbox-image，adapters）
与运行期（rpc-channel 的模板解析，core）**共用**，且必须两边一致，否则构建出的镜像名与运行时
解析出的模板名对不上。

**这类共享纯逻辑的正确归属是中立位置，不是任何一端。** 仓内已有先例：
`src/source-key.ts` 是顶层的纯 node builtins 模块，注释写明它是「面⑦ per-source 配置目录 /
面⑤ dist 寻址复用的单一事实来源」。`template-name.ts` 是同一形态。

### 2.2 `runner → auth` 与 `runner → ai-gateway` —— 同源的两条

```
runner/option-mapper.ts:30-34  { createSharedModelServices, registerEgressProvider,
                                 resolveEgressSpecFromEnv }        ← ../auth/egress-model-source.js
runner/option-mapper.ts:36-40  { AI_GATEWAY_PROVIDER_NAME, registerAiGatewayProvider,
                                 resolveAiGatewaySessionSpecFromEnv } ← ../ai-gateway/session-model-source.js
```

用法集中在 `option-mapper.ts:350-364`：读 env → 建共享 ModelRegistry → 注册两个 provider。
调用链是 `agent-loader.ts` → `buildRuntimeFactory`，**发生在 runner 子进程的装配期**。

`auth/egress-model-source.ts`（183 行）值导入 pi SDK 的 `AuthStorage` / `ModelRegistry`；
`ai-gateway/session-model-source.ts`（201 行）只 `import type { ModelRegistry }`。

★ **两条是同一个概念的两个实例**：「把一个 provider 注册进 pi 的 ModelRegistry」。
故不应各修各的，而应抽出**一个契约**、由装配层注入 N 个实现。将来再加第三个 provider
（很可能会）就不必再动 runner。

★ **注入点必须开在 runner 的引导入口，不能开在 option-mapper**。若只让 option-mapper 接收参数、
而由 `runner.ts` 去 import 那两个模块，边只是从一个文件挪到另一个文件，`runner → adapters`
依然成立。真正的解耦要求 runner 包**完全不提及**这两个具体实现。

### 2.3 `config → http` —— 双向依赖，且 5 个文件放错目录

```
config/config-routes.ts             ┐
config/mcp-config-routes.ts         │  各 import { errorResponse, jsonResponse } from "../http/index.js"
config/source-settings-routes.ts    ├─ 及 type { AuthContext, InjectedRoute, RequestContext }
config/extensions-config-routes.ts  │
config/sandbox-project-routes.ts    ┘
```

同时既有扫描已确认 `http → config` 也成立 —— 即 **config 与 http 目前是双向依赖**。

★ 这 5 个文件是**路由**，不是配置域逻辑。而 `http/routes/` 目录下**已经住着 11 个同类文件**
（`config-routes` 之外的所有路由）。它们放在 `config/` 下是历史 co-location，不是设计意图。

移到 `http/routes/` 后：
- `config → http` 消失；
- 新增的 `http/routes/* → config/*`（ConfigCodec / secret-merge / mcp-probe / schema-resolver 等）
  是**正确方向**（http 在 config 之上），且 `http → config` 本就存在，不新增边。

**导出表面如何保持不变**：这 5 个路由工厂现由 `config/index.ts` re-export，而主 barrel 对
`config/index.js` 与 `http/index.js` 都是 `export *`。把导出从 config 的 barrel 挪到 http 的 barrel，
**主入口的符号集合逐个不变**。且包的 exports 只有 6 个子路径（`.` / `./trust` / `./model-options` /
`./vision-model-options` / `./testing` / `./host-assembly`），**没有** `./config` 子路径，
故不存在绕过主 barrel 的深层导入路径。

### 2.4 `capability → auth` —— 确认可不处理

`capability/types.ts` 只 `import type`，编译期擦除。切包后跨包 `import type` 合法。
**刻意不处理**，并在守卫里显式豁免（豁免须写出来，否则下一个人会以为是漏网）。

---

## 3. 设计决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | `template-name.ts` 移到顶层 `src/template-name.ts` | 它是 core 与 adapters 共用的纯命名逻辑；仓内已有同形先例 `src/source-key.ts` |
| D2 | 抽 `ModelSourceRegistrar` 契约，两个具体注册器由**引导入口**注入 | 两条边同源；注入点开在 option-mapper 之上，否则边只是换个文件 |
| D3 | 5 个 `*-routes.ts` 从 `config/` 移到 `http/routes/` | 它们是路由；`http/routes/` 已有 11 个同类文件；移后 config↔http 由双向变单向 |
| D4 | 导出从 `config/index.ts` 挪到 `http/index.ts` | 主 barrel 对两者都 `export *`，符号集合不变；无 `./config` 子路径导出 |
| D5 | `MemoryWorkspace` 移到 `src/workspace/testing/` | 经既有 `./testing` 子路径导出，与一致性套件同址 |
| D6 | 守卫按**模块名册**判定，显式豁免纯类型边 | 豁免必须写出来才不会被误读为漏网 |

### 3.1 综合三镜

- **Generalization**：D2 把两条边收敛成一个契约 —— 这不是过度抽象，实证是「同一概念的两个实例」，
  且第三个 provider 已可预见（main 刚加了第二个）。
- **Build vs Adopt**：无外部方案可采；全部是仓内结构调整。
- **Simplification**：D1 与 D3 都**否定了 brief 里更复杂的方案**（注入 / 工厂上移），改为
  「把放错位置的文件放回正确位置」。移动文件比引入间接层便宜得多，也更容易复核。

---

## 4. 风险

| 风险 | 影响 | 缓解 |
|---|---|---|
| D3 移动 5 个文件后主 barrel 符号集合变化未被察觉 | 高（跨仓静默不匹配） | 移动前后各导出一次主入口符号清单，逐字比对 |
| D2 的注入改动触及 runner 子进程装配期，失败形态是「装配成功但模型不可用」 | 高 | it 档已有覆盖 runner 装配的用例；须比对 provider 注册结果而非仅看进程起来 |
| D1 移动后构建期与运行期命名不一致 | 高（镜像名与模板名对不上） | 两侧从同一模块导入即结构性保证；守卫断言无第二份实现 |
| 守卫名册与实际模块漂移 | 中 | 守卫断言「名册覆盖 `src/` 下每个模块目录，无未归类」 |

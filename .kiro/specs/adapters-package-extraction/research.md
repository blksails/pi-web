# Research & Design Decisions: adapters-package-extraction

## Summary

- **Feature**: `adapters-package-extraction`
- **Discovery Scope**: Extension（在既有三包工作区里新增第四个包）
- **勘察方式**：主对话直接实测（本会话 18 次子代理派单**无一交付结构化报告**，故不依赖它们）
- **Key Findings**：
  1. ★ **adapters 集合对装配层完全闭合** —— 12 个模块无一引用 `host-assembly` / `compat` /
     主 barrel / `runner-bootstrap-path`。**没有反向边要解**，搬迁难度远低于预期。
  2. ★ **集合内部只有 2 条跨模块边**：`ai-gateway → tokens`、`identity → auth`，均在集合内，随包整体移动。
  3. ★ **`resolvePiCliEntry()` 按字符串在运行时向上走目录解析 agent SDK** —— 解析基准随包移动，
     且 monorepo 的向上查找会**兜住依赖声明的遗漏**（与上一轮 5.1 的 tool-kit 陷阱同一机制）。
  4. ★ **那句被实测证伪的注释还有第三处**（`extensions/cli/pi-cli.ts:46`）—— 上一轮只修了两处。

---

## Research Log

### adapters 集合的封闭性

- **命令**：对 12 个模块 grep `from "../(host-assembly|compat|index|runner-bootstrap-path)"`
- **输出**：空
- **Implications**：集合与装配层之间**没有反向边**。这与 runner 那轮的画像一致（静态上行边 0），
  是 `kernel-boundary-decoupling` 与 `core-package-extraction` 的累积成果。
  搬迁只需处理**包级 specifier 重写**与**装配层对集合的引用方向**（后者是 assembly → adapters，正向）。

### 依赖分布（57 文件全量扫描）

| 目标 | 次数 |
|---|---|
| `@blksails/pi-web-core/*` | 74 |
| `node:` 内置 | 12 |
| `@earendil-works/pi-coding-agent` | 6 |
| `@blksails/pi-web-logger` | 5 |
| `@modelcontextprotocol/sdk/*` | 5 |
| `@blksails/pi-web-protocol` | 4 |
| `zod` | 3 |
| `e2b` | 2 |
| `pg` | 1 |
| `@earendil-works/pi-ai` | 1 |

- **Implications**：新包依赖面 = `core / logger / protocol / zod` + `e2b / pg / MCP SDK`
  + peer 的 agent SDK 两包。core 是压倒性的出向目标（74 次），方向正确。

### 装配层对集合的引用（决定接线面）

- `host-assembly/session-store.ts:14`、`host-assembly/default-capabilities.ts:26`
  → `session-store-postgres/factory.js`
- `host-assembly/default-capabilities.ts:21` → `mcp-probe.js`
- 主 barrel `index.ts` 8 条 `export *`（`extensions:30` / `tokens:46` / `auth:50` /
  `llm-gateway:54` / `ai-gateway:58` / `identity:86` / `sandbox-transport:92` /
  `session-store-postgres:93`）
- **无任何按需动态 import** —— 当前形态下 adapters 是无条件加载的
- **Implications**：接线面很小（3 处装配引用 + 8 条 barrel 转发）。8 条转发正是本轮要**移除**的。

### `resolvePiCliEntry()` 的运行时包解析（★ 迁移风险）

- **Sources**：`packages/server/src/extensions/cli/pi-cli.ts:43-70`
- **Findings**：两级基准 —— ① 本模块 `import.meta.url`，② `process.cwd()`；
  各自交给 `locatePackageDir(spec, base)` **逐级向上**在 `node_modules` 里找
  `@earendil-works/pi-coding-agent`。
- **Implications**：
  - 搬包后基准①从 `packages/server/src/extensions/cli/` 变为 `packages/adapters/src/extensions/cli/`；
  - 向上走会依次试 `packages/adapters/node_modules` → `packages/node_modules` → 仓库根 `node_modules`；
  - ★ 仓库根**有** agent SDK（兼容层依赖它），故**即便新包漏声明该依赖，本地也照样解析成功** ——
    与上一轮 5.1 的 tool-kit 陷阱**完全同构**。真实安装树（只装 adapters）会失败。
  - ⇒ 必须补一条**静态断言**：agent SDK 必须声明在新包自己的清单里。

### 被证伪注释的第三处

- **Sources**：`packages/server/src/extensions/cli/pi-cli.ts:46-50`
- **Findings**：仍写着「webpack 把 standalone bundle 里的 `import.meta.url` **内联成构建机绝对路径**」。
  上一轮已实测证伪（esbuild `format:"esm"` **保留** `import.meta.url`，`dist/server.mjs` 里 7 处活的），
  并修了 `runner-bootstrap-path.ts` 与 `scripts/build-server.mjs` 两处 —— **漏了这一处**。
- **Implications**：同一句错话散落三处，说明它当年是复制传播的。本轮修第三处时应搜净，
  并把「同一论断散落多处」本身登记为教训（与两处 `AGENT_CMD` 字节契约断言同一形态）。

---

## Architecture Pattern Evaluation

| 方案 | 描述 | 优点 | 风险 | 判定 |
|---|---|---|---|---|
| 单个 adapters 包 | 12 模块进一个包 | 一个包、维护面小；集合本就闭合 | 宿主无法只装其中一部分 | ✅ **选定**（用户拍板全口径） |
| 按外部系统拆多包 | e2b / pg / gateways / auth 各一包 | 真正「按需只装」 | 5–8 个新包，维护与版本成本高；本轮无消费方要求这种粒度 | ❌ 过早 |
| 不切包，只收紧守卫 | 保持现状，加严守卫 | 零搬迁成本 | 分层永远只是逻辑约定；未来宿主无从组合 | ❌ 已被用户否 |

---

## Design Decisions

### Decision: 主入口导出面收窄的留痕方式

- **Context**：R3.2/R3.3 要求基准重生成是**有意声明**且被移除符号**可逐一枚举**。
- **Selected Approach**：保留旧基准文件为 `main-entry-symbols.<旧版本>.txt`（或等价的
  「移除清单」工件），新基准并存；并在提交信息与交付报告中给出**逐一枚举的移除清单**。
- **Rationale**：「有意移除」与「不小心弄丢」在 diff 上长得一样。只有把被移除的符号
  **显式列出来**，后来者才能分辨。数量差（313 → N）不够。
- **Trade-offs**：多一份工件；但它正是本轮唯一能证明契约变更是有意的证据。

### Decision: agent SDK 的声明须由静态断言把关

- **Context**：`resolvePiCliEntry()` 的向上查找会被 monorepo 根兜住（见上）。
- **Selected Approach**：沿用上一轮 5.1 的解法 —— 除「能解析出来」的运行断言外，
  另加一条**读清单**的静态断言：agent SDK 必须声明在新包自己的依赖里。
- **Rationale**：运行断言在 monorepo 里**恒真**，守不住真实安装树。上一轮实测过：
  摘掉 tool-kit 声明并删链接，解析仍成功。

### Decision: `identity/` 不补端口

- **Context**：core 无 `IdentityProvider` 端口（brief 假定有，实测没有）。
- **Selected Approach**：按普通模块随包搬迁，**不新造端口**（R4.2）。
- **Rationale**：补端口是逻辑变更，破「只搬不改」，且本轮没有消费方要求该抽象。
- **Follow-up**：若将来有第二个身份实现，再单独立 spec 定端口。

---

## Risks & Mitigations

- **R-1｜主入口收窄破坏跨仓消费方**——已知并接受（用户拍板）。缓解：major 版本 +
  登记受影响方；跨仓改动不在本轮。
- **R-2｜`resolvePiCliEntry()` 在真实安装树失效**——monorepo 掩盖遗漏。
  缓解：静态声明断言（见上）。
- **R-3｜运行时路径字符串与重复写死的契约**——本仓两次栽过（3.3 的 fixture 路径、
  4.2 的第二处 `AGENT_CMD`）。缓解：R6.6 要求专门搜索；本轮已知至少一处同类
  （被证伪注释的第三处）。
- **R-4｜装配层引用面虽小但集中**——3 处装配引用全在 `host-assembly/`，
  改错会让默认能力面静默缺失。缓解：以能力面装配的既有测试把关。

## References

- `packages/core/test/tiering/module-roster.ts` — adapters 层的权威判定（12 个模块）
- `packages/server/src/index.ts:30-93` — 8 条待移除的 `export *`
- `packages/server/src/extensions/cli/pi-cli.ts:43-70` — 运行时包解析与第三处过时注释
- `.kiro/specs/runner-package-extraction/validation.md` — 上一轮的证据组织方式与三处既有红

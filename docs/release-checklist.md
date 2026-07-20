# 发版清单

> 本清单只收录**机制无法自动保证、必须由人判断**的条目。
> 凡是能靠构建/测试兜住的，一律做成机制而不是写进清单 —— 清单靠纪律，纪律会失效。

---

## `@blksails/pi-web-kit`：API 破坏必须 bump **major**，不要用 minor

webext 的兼容判定（`packages/react/src/web-ext/extension-gate.ts` 的 `isApiCompatible`）对 caret 范围采用「**同 major 且 host >= spec**」，`0.x` 与 `>=1` 走同一条规则 —— 即 **minor 跳动不再拦截任何扩展**。

因此：**web-kit 若发生破坏性 API 变更（删除/重命名导出、改变既有签名语义），必须 bump major（`0.x` → `1.0.0`）**。发 minor 不会阻止旧扩展加载，它们会照常载入然后在运行时炸。

### 为什么规则是这样（勿"修正"回标准 semver）

标准 semver 下 `^0.1.0` 只匹配 `0.1.x`，因为 0.x 的每个 minor 都被假定可能破坏。此处刻意偏离，原因见 `extension-gate.ts` 的实现注释，摘要：

- 宿主版本此前长期自述 `0.1.0`（`server/bootstrap.ts` 曾用 `env ?? "0.1.0"` 兜底，而包实际已到 0.5.0），**minor 从未真正充当过保护边界** —— 真有破坏时它照样放行。放宽不是失去保护，而是承认这份保护本就不存在。
- web-kit 版本随 monorepo 统一 bump（与 protocol/server 同为 0.5.x），minor 跳动不表达 API 破坏。实测 `0.1.0 → 0.5.0` 导出面纯增量：原有符号一个未删，新增运行时值仅 `renderSurfaceOp`，其余全是编译期擦除的 type。
- 仓内 14 个 example 的 dist 全部声明 `^0.1.0`。若恢复同-minor 判定，宿主一旦自述真实版本，它们会**全部**被拒载。

### 已由机制保证、无需人工核对的部分

- **宿主版本与包版本的对齐**：`server/bootstrap.ts` 的宿主自述版本由构建期从 `packages/web-kit/package.json` 读出并内联（唯一读取点 `scripts/web-kit-version.mjs`，四条构建路径共用）。不再需要设 `NEXT_PUBLIC_PI_WEB_KIT_VERSION`，该 env 降级为可选覆盖。
- **对齐的护栏**：`test/host-api-version.test.ts` 断言宿主自述版本 === web-kit 包版本。注入失效或有人改回硬编码，测试立刻红。

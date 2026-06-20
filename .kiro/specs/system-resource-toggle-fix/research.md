# Research Log — system-resource-toggle-fix

## Discovery Scope
轻量(light)集成型发现:既有缺陷,根因已在检阅会话中实测定位。无需外部 WebSearch;全部为代码内追踪。

## 关键调查与证据

### 1. 三段链路与断点
| 段 | 位置 | 状态 | 证据 |
|---|---|---|---|
| 写盘 | UI `extensions` 配置域 → `~/.pi/agent/settings.json` | ✅ | 文件含 `"loadSystemSkills": false` |
| 注入 argv | `lib/app/system-resource-args.ts` → `lib/app/pi-handler.ts:100 resolve()` | ✅ | `ps` 实测每个 `runner-bootstrap.mjs` 子进程都带 `--no-skills` |
| custom 解析 | `packages/server/src/runner/runner.ts:63 parseRunnerArgs` | ❌ 断点 | 仅识别 7 个 flag,`--no-skills`/`--no-extensions` 落在所有 else-if 之外被静默丢弃 |

### 2. CLI vs custom 分叉(`packages/server/src/agent-source/assemble-spawn.ts`)
- custom 分支(line 61-71):`extraArgs` 拼给 `runnerEntry`(runner-bootstrap)→ parseRunnerArgs 丢弃 → **无效**。
- CLI 分支(line 84-91):`extraArgs` 拼给 `piCliEntry`(真 pi CLI)→ pi 原生识别 → **有效**。
- 结论:assemble-spawn **无需改动**;修复点在 runner 解析与 option-mapper。

### 3. option-mapper 现状(`packages/server/src/runner/option-mapper.ts`)
- `mapResourceLoaderOptions(def, { forcedExtensionPaths })`:`def.skills !== undefined` → `skillsOverride = def.skills`(line 157-159);`def.extensions` → `noExtensions=true` 或 `extensionsOverride`(line 130-154)。
- `buildRuntimeFactory(def, trust)`(line 209):读 `PI_WEB_SANDBOX_ENTRY` 算 `forcedExtensionPaths` → 调 `mapResourceLoaderOptions`。
- 不变量(line 92-94 注释实证):**SDK 在 `noExtensions` 下仍加载 `additionalExtensionPaths`**,故 pi-sandbox 强制注入/沙箱门不受 `--no-extensions` 影响。

### 4. 现成可复用件
- `packages/agent-kit/src/minimal-preset.ts:6` `noSkills: SkillsOverride = ({ diagnostics }) => ({ skills: [], diagnostics })`——与 pi CLI `--no-skills` 语义一致(清空全部 skills)。可在 runner 侧等价内联(server 与 agent-kit 的 SkillsOverride 同源自 SDK `ResourceLoaderOptions["skillsOverride"]`)。

### 5. agent-loader shape 分类(`packages/server/src/runner/agent-loader.ts`)
- shape (a) 定义对象 / shape (b) `(ctx)=>def`:均经 `buildRuntimeFactory` → 可注入。**所有 webext 示例(`defineAgent`)属此**。
- shape (c) branded `CreateAgentSessionRuntimeFactory`:直接返回、绕过 option-mapper → **本特性注入不覆盖**(列为边界外,见 design)。

## 设计决策与理由(synthesis)
1. **透传 vs env**:选**显式参数透传**(parseRunnerArgs→RunnerArgs→loadAgentDefinition→buildRuntimeFactory→mapResourceLoaderOptions),不走 env。理由:可单测、与既有 `--trusted` 等 flag 一致、不污染全局。
2. **noSkills 优先于 def.skills**:`--no-skills` 时无条件令 `skillsOverride = () => ({skills:[]})`,覆盖 agent 自声明 skills。理由:对齐 pi CLI `--no-skills` 行为,满足需求 4.2「CLI 与 custom 结果一致」。
3. **noExtensions 优先于 def.extensions 白名单**:`--no-extensions` 时令 `resourceLoaderOptions.noExtensions = true` 并跳过 `extensionsOverride` 白名单分支;`additionalExtensionPaths`(沙箱)仍保留。理由:满足需求 2.3 沙箱门不破 + 2.1 不载入系统/包扩展。
4. **assemble-spawn / CLI 路径不动**:CLI 已正确,改动面最小,降低回归风险(需求 4)。

## 风险
- shape (c) agent 不受开关影响(边界外,文档声明)。webext 示例不受影响。
- option-mapper 既有测试(`option-mapper.test.ts` / `option-mapper-forced-inject.test.ts`)引用 no-skills 语义,改动需保持其通过(需求 5.3)。

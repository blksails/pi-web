# Implementation Plan — publish-host-command

## Phase 1 · 协议与卡片类型机制

- [x] 1.1 `PublishPreviewData` schema + data part
  - `packages/protocol`：新增 `PublishPreviewDataSchema`（`package` / `files` / `warnings` /
    `disclaimers{unsigned,grantNotChecked}` / `error{code,message,hint}`）
  - `disclaimers` 用**布尔位**，不是文案（测试断言结构而非中文子串）
  - barrel 导出；不改 `InstallResultDataSchema`
  - _Requirements: 1.2, 2.1, 2.2, 5.2_

- [x] 1.2 `CommandResult.dataPart` + pi-chat 取值优先级
  - `packages/protocol`：`CommandResult` 加可选 `dataPart?: string`（纯加法）
  - `packages/ui/src/chat/pi-chat.tsx`：`result?.dataPart ?? builtinResultDataParts?.[cmd.name]`
  - ★ 注释写明安全边界：`dataPart` **只允许服务端 handler 写入**，不得接到用户可控数据；
    未知类型 fail-soft 不渲染
  - _Requirements: 1.1_
  - _Depends: 1.1_

- [x] 1.3 单测：卡片类型优先级
  - `dataPart` 存在 → 用它；缺省 → 按命令名查表（既有行为逐条不变）
  - _Requirements: 8.1_
  - _Depends: 1.2_

## Phase 2 · 预览编排

- [x] 2.1 `lib/app/publish-preview.ts`
  - `createPublishPreview({ kind })`：`compile(dir)` → kind 门 → 组装 `PublishPreviewData`
  - kind 门：清单 `kind` 权威；与命令锁定类别不符 → 拒绝并指出应改用哪条命令
  - `CompileError` **八分支逐一**给"改哪里"的说明（`KEY_UNUSABLE` 本轮不可达，仍穷尽 + 注释）
  - 告警进 `warnings` 一等字段，**不得**并入 `steps`
  - 全程零外部写、零凭据；输出面走 `redactSecrets`
  - _Requirements: 1.1, 1.3, 2.1, 2.2, 3.1, 3.2, 3.3, 5.1, 5.2, 5.3, 7.2_
  - _Depends: 1.1_

- [x] 2.2 接入 `package-host-command` 工厂
  - `AGENT_ACTIONS` / `PLUGIN_ACTIONS` 各加 `publish`
  - `--dry-run` → 预览；**裸 `publish` → `PUBLISH_NOT_AVAILABLE`**（真发布意图的诚实降级），
    附「改用 `--dry-run` 可预览」指引，且不泄露令牌/密钥路径/内部端点
  - 结果带 `dataPart: "data-publish-preview"`；`effect` 不重载会话
  - 两条命令用法文本各加一行 publish
  - _Requirements: 1.4, 1.5, 2.3, 6.1, 6.2, 7.1_
  - _Depends: 2.1, 1.2_

- [x] 2.3 单测 `test/commands/publish-preview.test.ts`
  - 成功形状（含两个 disclaimers 布尔位为 true）／kind 不符拒绝并指路／裸 publish →
    `PUBLISH_NOT_AVAILABLE`／adminGate 拒绝 + 审计／argv 夹带凭据时输出面脱敏
  - **真实夹具**（Req 8.2，不用编译替身）：
    - 成功：`examples/plugin-code-review-agent`（实测 kind=plugin / 5 文件 / 0 告警，
      **无构建依赖**）经 `/plugin publish` 预览成功
    - kind 不符：同一目录经 `/agent publish` → 拒绝并指向 `/plugin publish`
    - component：`examples/canvas-component-watermark` → 两条命令都拒绝
    - 编译失败：临时目录造一个缺 `kind` 的清单 → `MANIFEST_KIND_REQUIRED`
    - ★ **不要**用 `examples/aigc-canvas-agent` / `module-settings-agent` 当成功夹具:
      实测它们在 fresh worktree 恒失败于 `WEBEXT_SOURCE_WITHOUT_DIST`(`.pi/web/dist`
      是 gitignored 构建产物)。它们只适合当**失败**用例。
  - **零外部写**（Req 8.4）：预览前后包目录快照比对一致；全局 `fetch` 替身断言零调用
  - _Requirements: 8.1, 8.2, 8.4_
  - _Depends: 2.2_

## Phase 3 · 补全与渲染

- [x] 3.1 扫描 provider 参数化
  - `packages/server` `ScanInstallSourceOptions` 加 `markers?` / `insertPrefix?`，
    保留现有默认值（install 行为**逐字节不变**）
  - 新增 `createScanPublishSourceProvider()`：markers = `[PI_WEB_MANIFEST_FILENAME]`，
    `insertPrefix = ""`
  - ★ realpath 越界防护是**安全边界**，参数化不得削弱
  - 端口类型不改名；在注释中说明它是"枚举候选目录"、与用途无关
  - _Requirements: 4.2, 7.3_

- [x] 3.2 补全参数位接线
  - `CommandArgKind` 加 `"publishableDir"`；`package-arg-provider` 两个 SPEC 各加 `publish` 词条
  - 补全端点接 `createScanPublishSourceProvider`，与执行同基准（`session.cwd`）
  - i18n 文案（zh/en）
  - _Requirements: 4.1, 4.3_
  - _Depends: 3.1_

- [x] 3.3 `PublishPreviewRenderer`
  - `packages/ui`：新渲染器，注册到 `data-publish-preview`
  - **醒目**渲染 disclaimers（据布尔位，非文案匹配）；warnings 独立区块，与错误视觉可辨
  - 文件清单：**全量展示 + 总数可见，不截断**（实测真实包 0–5 条；长清单用可滚动容器，
    不静默丢条目）
  - 失败态展示 `error.code` / `message` / `hint`
  - _Requirements: 1.2, 2.1, 2.2, 5.1, 5.2_
  - _Depends: 1.1_

- [x] 3.4 单测：provider + 渲染器
  - provider：只产出含清单的目录／`insertText` 无 `local:` 前缀／越界防护仍生效／
    **既有 install provider 行为逐条不变**
  - 渲染器：disclaimers 两个布尔位各自渲染；warnings 非空时可见且与 error 区块可辨；
    文件条目数与 `files.length` 一致（证明未截断）
  - _Requirements: 8.1_
  - _Depends: 3.1, 3.3_

## Phase 4 · e2e 与终验

- [x] 4.1 e2e 夹具：最小 agent 包
  - `e2e/fixtures/publish-sample-agent/`：`pi-web.json`（kind=agent）+ 入口文件
  - ★ 必须**无构建依赖**（不带 `.pi/web` 源），否则重蹈 examples 那两个包的覆辙
  - 先本地实跑 `compile()` 确认通过再写用例
  - _Requirements: 8.3_

- [x] 4.2 e2e `e2e/browser/publish-command.e2e.ts`
  - 跑在 `install` project（已有 admin 放行 + 隔离落盘）
  - `/agent publish ./e2e/fixtures/publish-sample-agent --dry-run` → 预览卡片可见，
    含「未签名」声明、含文件清单
  - `/agent publish ./examples/plugin-code-review-agent --dry-run` → 拒绝并指向 `/plugin publish`
  - 裸 `/agent publish <dir>` → `PUBLISH_NOT_AVAILABLE` 卡片
  - _Requirements: 8.3, 2.1, 3.2, 6.1_
  - _Depends: 2.2, 3.3, 4.1_

- [x] 4.3 全量回归与终验
  - 根 vitest + `packages/server` + `packages/ui` + `packages/tool-kit` + `packages/protocol`
    （★ 只跑根 vitest 会漏子包红）
  - playwright `install` project 全绿；`registry`/`fs` 不回归
  - ★ e2e 前先 `pnpm build:server` + `build:client`（本 spec 上一轮踩过：e2e 跑的是 dist，
    不重建就是在测旧代码）
  - 按 `verify-completion` 取新鲜证据后再宣称完成
  - _Requirements: 8.1, 8.2, 8.3, 8.4_
  - _Depends: 3.4, 4.2_

## Implementation Notes

### 设计阶段实测（决定了夹具选型）

对 `examples/` 四个包实跑 `compile()`：

| 包 | 结果 |
|---|---|
| `plugin-code-review-agent` | OK · kind=plugin · 5 文件 · 0 告警 · **无构建依赖** |
| `canvas-component-watermark` | OK · kind=component · 0 文件 |
| `aigc-canvas-agent` | FAIL `WEBEXT_SOURCE_WITHOUT_DIST` |
| `module-settings-agent` | FAIL `WEBEXT_SOURCE_WITHOUT_DIST` |

后两个失败因 `.pi/web/dist` 是 gitignored 构建产物 —— 在 fresh worktree 恒失败。
故：成功夹具用 code-review（plugin）+ 自建最小 agent 包；那两个只当失败用例。

这也顺带回答了 Open Question 1：真实包文件数 0–5，清单折叠不是必需；定为**不截断**。

### 实施中修正的两处(都由测试/真机抓到,非评审发现)

1. **`hint` 漏脱敏 → 凭据泄露**。只对 `message` 做了 `redactSecrets`,`hint` 里嵌的
   `expectedPath` 把 argv 原样带了出去。更深一层:`path.resolve` 会把
   `https://user:token@host/x` 压成 `https:/user:token@host/x`(**单斜杠**),而
   `redactSecrets` 的 URL 凭据规则要求 `://`,**对这个形态失效**。
   故最终修法不是给脱敏打补丁,而是**不回显用户可控路径** —— `MANIFEST_MISSING` 只报清单
   文件名。单测钉住。

2. **e2e 路径基准判断错**。原以为会话源用 `./examples` 时会话 cwd = 仓库根;真机实测
   **会话 cwd 就是 `<repo>/examples` 本身**(`/publish-sources` 给出的候选是
   `./plugin-code-review-agent` 而非 `./examples/plugin-code-review-agent`)。
   已按实测基准改写用例,并把该事实写进 e2e 文件头。

### 证据(2026-07-28)

- 类型检查:通过
- 根 vitest:**955 通过 / 2 跳过**(97 文件)
- packages/ui:**851 通过**;tool-kit:463;protocol:417
- packages/server:2433 通过,**2 条 attachment 集成测试红** —— 已用 `git stash` 回到改动前
  基线复跑,基线同样红(1 failed),且该文件**隔离跑 3/3 全绿** ⇒ 负载相关的既有抖动,
  与本 spec 无关
- playwright `install` project:**5/5 绿**(含 publish 三例);`registry`/`fs` 不回归

# Implementation Plan — `config-workspace-injection`

> 验收：两 codec + 两路由工厂接注入、HostDeps/defaultCapabilities 透传、内存 Workspace 等价测试全绿、无回归、发 0.5.3。
> 契约 §8.1 C3 前置；设计见 `design.md`。首刀只做 domains + source 两个 Workspace-ready codec。

## 1. Codec 注入接缝
- [x] 1.1 `ConfigCodec` 接受注入 `WorkspaceNamespace`
  - 构造签名 `(source?: string | WorkspaceNamespace)`：`typeof source === "string" || undefined` → 现状自建；否则直接持有注入 namespace。`load`/`save` 体不动。
  - 观察完成态：`new ConfigCodec(memoryNs)` 与 `new ConfigCodec(tmpDir)` 对同一序列读写/合并/损坏降级结果一致（新增测试通过）
  - _Requirements: 1.1, 1.2, 1.3, 1.4_
  - _Boundary: config-codec.ts_

- [x] 1.2 `SourceSettingsCodec` 接受注入 `Workspace`（双根）
  - 构造 `(source?: string | Workspace)`；`nsAndKey`：注入时 source→`workspace.user`、project→`workspace.project`（project scope 注入时不要求 cwd）；未注入走现状；两分支都 `assertSourceKeyShape`
  - 观察完成态：注入内存 Workspace 后 source/project 两 scope 各落对应根、键正确、越权 sourceKey 被拒；与 agentDir 分支等价（测试通过）
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_
  - _Boundary: source-settings-codec.ts_

## 2. 路由工厂 + 装配透传
- [x] 2.1 `createConfigRoutes` / `createSourceSettingsRoutes` 加 `workspace?` opt
  - 两工厂 opts 加 `workspace?: Workspace`；提供时用 `workspace.user`（config）/注入 Workspace（source）构造 codec，否则用 `rootDir`；其余 opts 与端点行为不变
  - 观察完成态：`createConfigRoutes({ workspace })` GET/PUT `/config/:domain` 往返走注入分支；未传时现状不变
  - _Requirements: 3.1, 3.2, 3.3_
  - _Depends: 1.1, 1.2_
  - _Boundary: config-routes.ts, source-settings-routes.ts_

- [x] 2.2 `HostDeps` 加 `workspace?`/`adminPolicy?` + defaultCapabilities 透传
  - `HostDeps` 加可选 `workspace?: Workspace`、`adminPolicy?: ConfigAdminPolicy`；config.domains/source factory 透传 `d.workspace`/`d.adminPolicy`（缺省不传=现状）；id 集与顺序不变（config.mcp 仍在 config.domains 前）
  - 观察完成态：`default-capabilities.test.ts` id 集守卫仍绿；传 workspace 时 factory 走注入分支
  - _Requirements: 4.1, 4.2, 4.3_
  - _Depends: 2.1_
  - _Boundary: default-capabilities.ts_

## 3. 测试 + 发版
- [x] 3.1 内存 Workspace 等价测试
  - 两个 codec 的注入分支 vs 路径分支逐条等价（缺键/deepMerge/merge:false 覆盖/损坏降级/双根键）；路由注入分支 GET/PUT 往返
  - 观察完成态：新增两测试文件全绿；`pnpm --filter @blksails/pi-web-server test` 全绿无回归；`typecheck` 绿
  - _Requirements: 5.1, 5.2, 5.3_
  - _Depends: 2.2_
  - _Boundary: config-codec.workspace-injection.test, source-settings-codec.workspace-injection.test_

- [x] 3.2 发版 0.5.3
  - bump `packages/server/package.json` 0.5.2→0.5.3；`pnpm publish`（含本增量,供 pi-clouds C3 消费）；push main
  - 观察完成态：`npm view @blksails/pi-web-server version` == 0.5.3；主 barrel/host-assembly 可消费 workspace? opt
  - _Requirements: 5.3_
  - _Depends: 3.1_

## Requirements 覆盖
| Req | 任务 |
|-----|------|
| 1.1–1.4 | 1.1 |
| 2.1–2.5 | 1.2 |
| 3.1–3.3 | 2.1 |
| 4.1–4.3 | 2.2 |
| 5.1–5.3 | 3.1, 3.2 |

## 回勾记录(2026-07-24)

本 spec 的实现随 commit `c3a7278`「feat(config): config.domains/source 工厂开 Workspace 注入接缝(0.5.3)」
落地,但 `tasks.md` 当时**未回勾**(spec.json 已是 `implemented`,与勾选状态不一致)。
本次按 kiro 规范**逐任务用代码证据核实 + 跑测试取新鲜证据**后回勾,不凭 phase 字段推断。

| 任务 | 证据 |
|---|---|
| 1.1 | `config-codec.ts:52` `constructor(source?: string \| WorkspaceNamespace)`,注入分支直接承载 |
| 1.2 | `source-settings-codec.ts:67` 注入 `Workspace` 承载双根 |
| 2.1 | `source-settings-routes.ts:108` `readonly workspace?: Workspace`;`:378` `new SourceSettingsCodec(opts.workspace ?? opts.rootDir)`;`config-routes.ts:26` 同款 |
| 2.2 | `default-capabilities.ts:61,67` `workspace?` / `adminPolicy?` 已进 HostDeps |
| 3.1 | `config-codec.workspace-injection.test.ts`(4) + `source-settings-codec.workspace-injection.test.ts`(3) |
| 3.2 | `packages/server/package.json` version = **0.5.3**(npm 已发布) |

**新鲜证据**:两个注入测试 + `default-capabilities` 契约守卫 **14 passed / 0 failed**(2026-07-24)。

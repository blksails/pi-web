# Implementation Plan

> ★ 本特性的缺口正因「开发路径恰好绕开」而长期不可见（`dev:desktop` 会加载 `.env.local`）。
> 故**开发模式下的通过不构成任何证据** —— 任务 5 的打包产物验证是唯一有效的验收面。
>
> 测试命令按 steering 分档：实现者用 `node scripts/scoped-test.mjs <paths>`，
> 复查者跑 `pnpm test` **+** `pnpm test:app`。

- [ ] 1. 配置载体

- [x] 1.1 新增 `desktop` config 域 (P)
  - 建 `packages/protocol/src/config/domains/desktop.ts`，schema 三个字段**全部可选**：
    `sourcePicker?: boolean` / `requireWebextSignature?: boolean` / `sourcesRoot?: string`
  - 在 `packages/protocol/src/config/index.ts` 导出，在
    `packages/core/src/http/routes/config-routes.ts` 的域注册表登记 `desktop`
  - 落盘路径由既有 ConfigCodec 决定（`~/.pi/agent/desktop.json`），不另写路径逻辑
  - 观察点：经既有 config 端点可读写该域；写入未知键后重读，未知键仍在（ConfigCodec 既有语义）
  - _Requirements: 3.1, 3.5_
  - _Boundary: desktop config 域 — `packages/protocol/src/config/domains/desktop.ts`, `packages/protocol/src/config/index.ts`, `packages/core/src/http/routes/config-routes.ts`_

- [ ] 2. 裁决逻辑

- [x] 2.1 实现 `resolveDesktopConfig` 纯函数 (P)
  - 建 `lib/app/desktop-defaults.ts`，签名与 design 的 Service Interface 逐字一致
  - 三级优先级：`env 显式值 > 用户配置 > 桌面默认值`；桌面判据取既有 `DESKTOP_MARKER_ENV`
  - 桌面默认：`sourcePicker=true`、`requireWebextSignature=false`
  - 纯函数：不读文件、不碰进程状态；env 与用户配置一律由调用方注入
  - 观察点：**非桌面形态 + 无配置时，返回值与本特性引入前逐字段相等** —— 这是 Req 1.3/4.2 的机械保证，不是「大致一样」
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.1, 3.2, 4.1, 4.2_
  - _Boundary: 桌面默认值裁决 — `lib/app/desktop-defaults.ts`_

- [x] 2.2 为裁决函数写穷举单测
  - 建 `test/desktop-defaults.test.ts`，五个用例对应 design 的 Unit Tests 清单
  - 「非桌面等价于既有默认」必须逐字段断言，不可只断言若干字段
  - 观察点：`node scripts/scoped-test.mjs test/desktop-defaults.test.ts` 退出码 0；
    且先确认这些用例在**未接线的代码上会红**，再信它们报的绿
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 3.2_
  - _Boundary: 裁决单测 — `test/desktop-defaults.test.ts`_
  - _Depends: 2.1_

- [ ] 3. 接线

- [x] 3.1 `sourcePicker` 等门控改经裁决函数
  - 改 `server/bootstrap.ts`：`sourcePicker` 取值由直接读 env 改为调用 `resolveDesktopConfig`
  - 读取 `desktop` 域配置作为入参；域缺失/损坏时传 `undefined`（不得抛）
  - 观察点：桌面形态下 `/api/bootstrap` 下发 `sourcePicker=true`；非桌面形态仍为既有取值
  - _Requirements: 1.1, 1.3, 1.4, 1.5, 3.2, 3.3, 4.2_
  - _Boundary: bootstrap 门控接线 — `server/bootstrap.ts`_
  - _Depends: 2.1_

- [x] 3.2 签名门控加「桌面 + 本机路径」放行分支
  - **先勘察调用链**：确认 `lib/app/webext/build-trust.ts` → `web-ext-gate-config.ts` 是否已把
    「来源」透传至门控构造点；未透传则补一条参数（design 已标此为风险点，改法以实际调用链为准）
  - 放行需两个条件同时成立：桌面形态 **且** 来源是本机文件系统路径；来源分类沿用 agent source
    解析既有结果，**不新造**「什么算本机路径」的判定
  - 放行时记一条可观测记录，使运维能分辨某次载入是否走了放行路径
  - **只改 `requireSignature` 一个字段**：`whitelist` 与浏览器侧 SRI 选项一律不动
  - 观察点：桌面+本机路径 → 放行；桌面+非本机来源 → 仍要求签名；非桌面+本机路径 → 仍要求签名。
    三种组合都要有断言，只测放行那条等于没测边界
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 4.1_
  - _Boundary: 签名门控放行 — `lib/app/web-ext-gate-config.ts`, `lib/app/webext/build-trust.ts`_
  - _Depends: 2.1_

- [x] 3.3 扫描根改为可配置
  - `desktop.sourcesRoot` 有值时覆盖默认扫描根；无值时维持
    `desktop-hybrid-agent-sources` 既有的默认根行为
  - 指向不存在的目录时视为空贡献，不使整列表失败（沿用该 spec Req 1.3 的既有约定）
  - 观察点：配置一个含 agent 的目录后，该目录下的源出现在列表中；配置一个不存在的路径后
    列表仍正常返回（只是不含该根的贡献）
  - _Requirements: 3.4, 4.3, 4.4_
  - _Boundary: 扫描根配置 — `server/bootstrap.ts` 或 agent source 装配处（以勘察结果为准）_
  - _Depends: 2.1_

- [ ] 4. 集成测试

- [x] 4.1 签名放行与配置域的集成用例
  - 覆盖 design 的 Integration Tests：三种形态×来源组合的签名判定；`desktop` 域读写与未知键保留
  - 观察点：`node scripts/scoped-test.mjs <涉及文件>` 退出码 0；新增用例在未接线代码上会红
  - _Requirements: 2.1, 2.2, 2.3, 3.5_
  - _Boundary: 集成测试 — `test/` 下相应测试文件（以实际落点为准）_
  - _Depends: 3.1, 3.2_

- [ ] 5. 打包产物验证（唯一有效的验收面）

- [x] 5.1 重新打包并在真实产物上取证
  - `pnpm build:dist` → `tauri build` → 从 dmg 安装到 `/Applications`
  - 三条取证：其 `/api/bootstrap` 下发 `sourcePicker=true`；对本机 agent 路径查
    `/api/webext/resolve` 且 `rejectedReason` 不再是「代码 webext 未签名」；真机启动后
    选源页出现 agent source 列表、目标 agent 的 pane 可载入
  - 第四条取证：在 `~/.pi/agent/desktop.json` 里把某项显式改成与默认相反的值，重启应用，
    确认新取值生效（Req 3.3 的用户可观察面 —— 配置若不生效，用户改了也白改且无提示）
  - ★ 开发模式下的通过**不得**充当本任务的证据（Req 5.4）
  - 观察点：四条取证全部来自打包产物；`lsof` 定位端口时注意 `-p` 与 `-i` 默认是 OR，须加 `-a`
  - _Requirements: 3.3, 5.1, 5.2, 5.3, 5.4_
  - _Boundary: 真机验证（不改代码）— 无写入_
  - _Depends: 4.1_

- [ ] 6. 回归

- [x] 6.1 全量回归与算术核对
  - 跑 `pnpm test` **和** `pnpm test:app` 两条（只跑其一会漏子包的红，且看起来与全绿一样）
  - 对每个汇总行核对 `failed + passed + skipped === 总数`，文件数与用例数各算一遍
  - 跑 `pnpm typecheck`（desktop 的 cargo 部分若因本机环境失败，须与 TS 侧分离判断）
  - 观察点：两条测试命令退出码 0、算术自洽、typecheck 0 error；与改动前基线相比无新增失败
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - _Boundary: 回归验证（不改代码）— 无写入_
  - _Depends: 5.1_

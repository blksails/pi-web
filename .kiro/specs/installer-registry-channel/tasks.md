# Implementation Plan — installer-registry-channel

## Phase 1 · 端口与通道实现

- [x] 1.1 导出 `isValidSourceId`，并补 `RegistryChannel` 端口类型
  - `packages/server/src/agent-source/online-source-id.ts`：`isValidSourceId` 加 `export`（纯加法）；
    确认 barrel 已导出该模块，否则在 `index.ts` 补一行
  - `server/cli/install/installer.ts`：新增 `RegistryMaterialization` / `RegistryChannelError` /
    `RegistryChannel`（含 `MANIFEST_KIND_UNKNOWN`）与 `CreateInstallerOptions.registryChannel`
  - 只加类型与导出，不改任何运行时分支；此步后全量测试须仍绿
  - _Requirements: 1.1, 2.2_
  - _Boundary: 不改 `source-resolver.ts`、不改 `installFromRegistry`_

- [x] 1.2 实现 `server/cli/install/registry-channel.ts`
  - `createRegistryChannel({ getRegistry, agentTargetRoot, pluginStagingRoot? })`
  - 标识解析：带 `@` 走 `parseOnlineSourceRef`，裸标识整串为 `sourceId` + 空 channel；
    两者都过 `isValidSourceId`，不合法 → `NOT_FOUND`
  - kind 门：读 `manifest["kind"]` 收窄；缺失/非法 → `MANIFEST_KIND_UNKNOWN`；`component` →
    `KIND_COMPONENT_UNSUPPORTED`；与 `expectedKind` 不符 → `KIND_MISMATCH`
  - **kind 门必须在 `downloadBundle` 之前**（拒绝路径零下载）
  - 落点：agent → `join(agentTargetRoot, registryInstallDirName(id))`，已存在且无回执 →
    `TARGET_OCCUPIED`；plugin → `mkdtemp` 暂存目录
  - 失败归一丢弃底层 `detail`（凭据卫生）
  - _Requirements: 2.2, 2.3, 2.4, 3.1, 3.2, 5.2, 5.3_
  - _Depends: 1.1_

- [x] 1.3 单测 `test/cli/install/registry-channel.test.ts`
  - 进程内 `RegistryPort` 夹具（可断言 `downloadBundle` 调用次数）
  - 覆盖：清单 kind 权威（`expectedKind` 不覆盖它）／kind 不符时 `downloadBundle` **零调用**／
    kind 缺失 → `MANIFEST_KIND_UNKNOWN`／`component` 拒绝／agent 与 plugin 落点分流／
    `TARGET_OCCUPIED`／`getRegistry` 返回 undefined → `NOT_AUTHENTICATED`
  - _Requirements: 7.1_
  - _Depends: 1.2_

## Phase 2 · Installer 接入

- [x] 2.1 `Installer.install()` 接上 registry 通道
  - 在 `resolveSource` **之前**用 `classifySourceForm(spec) === "registry"` 分派
  - 未注入通道 → `REGISTRY_UNAVAILABLE`；新增错误码 `REGISTRY_UNAVAILABLE` /
    `REGISTRY_KIND_MISMATCH` / `REGISTRY_INSTALL_FAILED`
  - agent → 直接返回 `InstallOutcome`；plugin → 转交
    `pluginChannel.install({kind:"local",path:dir}, scope)`，`finally` 清理暂存根
  - `mapResolveError` 的 `REGISTRY_NOT_IMPLEMENTED` 分支与 `source-resolver.ts` 各加注释：
    经 `Installer` 已不可达
  - `uninstall()` 不动
  - _Requirements: 1.1, 1.2, 3.1, 3.2, 5.1_
  - _Depends: 1.2_

- [x] 2.2 **实测裁定**：`pi install <本地目录>` 是拷贝还是链接
  - 真实跑一次 `pi install <某本地 plugin 目录>`，检查 pi 包目录是文件还是符号链接
  - 拷贝 → 暂存目录可删（保持 2.1 的 `finally` 清理）
  - 链接 → 改落稳定位置 `<agentDir>/registry-plugins/<dir>`（**不得**进 agent 扫描根），取消清理
  - 顺带记录：`.pi-web-registry.json` 回执是否随目录被 pi 保留
  - 结论写入 `research.md`；若回执未保留，记为已知限制，**不**改 `installFromRegistry`
  - _Requirements: 3.2, 3.4_
  - _Depends: 2.1_

- [x] 2.3 单测 `test/cli/install/installer-registry.test.ts`
  - registry 形态走通道／直连形态仍走原路（通道替身零调用）／未注入 → `REGISTRY_UNAVAILABLE`／
    `KIND_MISMATCH` → `REGISTRY_KIND_MISMATCH`／plugin 物化后确实以
    `{kind:"local",path:<物化目录>}` 调用 pluginChannel
  - _Requirements: 7.1_
  - _Depends: 2.1_

## Phase 3 · 两侧装配

- [x] 3.1 app 层惰性适配器 + `pi-handler` 注入
  - 新建 `lib/app/online-source/registry-channel-adapter.ts`：`createLazyRegistryChannel`，
    双 `import()` 失败 → `BACKEND_UNAVAILABLE`，**绝不静态引入**
  - `pi-handler.ts`：`packageCommandDeps.installer` 增 `registryChannel`；
    ★ `desktopCapabilitiesClient` 在 `packageCommandDeps` **之后**构造 → 用**闭包惰性**取，
    不移动构造顺序
  - 未配置云端 → `undefined` → `REGISTRY_UNAVAILABLE`
  - 验证 `pnpm dev:server` 能正常启动（惰性约束的实证）
  - _Requirements: 1.1, 4.4, 5.1_
  - _Depends: 2.1_

- [x] 3.2 CLI 收敛
  - `server/cli/index.ts`：删除 `runInstall` 里 `classifySourceForm(source)==="registry" && registry`
    那整段独立编排；改为在 `createDefaultInstaller(deps)` 注入 `createRegistryChannel(...)`
    （`getRegistry: buildRegistryFromEnv`，`agentTargetRoot: registryInstallRoot(env, cwd)`）
  - 输出等效：`InstallOutcome` 的 agent 分支带可选 `version`/`verifiedFiles`，CLI 有值时打印
    `<id>@<ver> 已装到 <dir>(复核 N 文件)`
  - 直连路径（本地/npm/git）行为不变
  - _Requirements: 4.1, 4.2, 4.3, 4.4_
  - _Depends: 2.1_

- [x] 3.3 host 命令层文案与卡片
  - `package-host-command.ts`：`REGISTRY_KIND_MISMATCH` 走 `guidanceForInstallerError` 给出
    「该包是 `<actual>`，请改用 `/<actual> install`」；`REGISTRY_UNAVAILABLE` 给出登录/配置指路
  - 两条命令的用法文本补一行：来源可以是 registry 标识
  - _Requirements: 2.3, 5.1_
  - _Depends: 2.1_

- [x] 3.4 单测扩充（host 命令 + CLI）
  - `test/commands/package-host-command.test.ts`：registry 成功卡片形状、
    `REGISTRY_UNAVAILABLE` 卡片、kind 不符卡片含指路文案
  - CLI install 既有测试：经注入 `Installer` 完成 registry 安装且输出等效；直连不回归
  - _Requirements: 7.1, 7.4_
  - _Depends: 3.2, 3.3_

## Phase 4 · e2e 与终验

- [x] 4.1 假 registry 夹具扩展
  - `e2e/fixtures/fake-cloud-server.mjs` 新增：
    `GET /registry/sources/:id/resolve`（id 经 `encodeURIComponent`，形如 `acme%2Fhello-cloud`）→
    `{sourceId, version, origin:{type:"oss",bundle}, manifest:{kind:"agent", entry:{path,integrity}}, ...}`；
    `GET /registry/sources/:id/bundle?key=...` → 真实 tgz 字节
  - ★ 启动时**现场**打包一个最小 agent 目录并算 sha384 写进 manifest —— 硬编码两个常量必然漂移，
    integrity 一旦不符复核必失败
  - 另备一个 `kind:"plugin"` 的源，供 kind 不符用例
  - _Requirements: 7.2_

- [x] 4.2 改写 e2e 用例
  - `e2e/browser/registry-agent-sources.e2e.ts`：把「`REGISTRY_NOT_IMPLEMENTED`」那例改写为
    **成功路径**——`/agent install acme/hello-cloud` → 成功卡片 → 随后 `/agent list` 能看到它
  - 新增一例：`/agent install <kind:plugin 的 registry 源>` → 失败卡片含改用 `/plugin` 的指路
  - 删除与新行为矛盾的断言与文件头「能力边界」注释块
  - _Requirements: 7.2, 7.3, 2.3_
  - _Depends: 3.1, 3.3, 4.1_

- [x] 4.3 全量回归与终验
  - 根 vitest + `packages/server` + `packages/ui` + `packages/tool-kit` + `packages/protocol`
    （★ 只跑根 vitest 会漏子包红）
  - playwright `registry` project 全绿；确认 `REGISTRY_NOT_IMPLEMENTED` 在全仓不再作为
    用户可见结果出现
  - 按 `verify-completion` 取新鲜证据后再宣称完成
  - _Requirements: 7.1, 7.2, 7.3, 7.4_
  - _Depends: 3.4, 4.2_

## Implementation Notes

### 实施中推翻的设计假设（详见 research.md）

1. **plugin 落点不能是暂存目录** —— 实测 `pi install <本地目录>` 只把路径写进
   `settings.json#plugins[]`，**不拷贝内容**。原设计的「落 tmpdir → 转交 → `finally` 清理」
   会让插件在清理后立刻失效。改为 `pluginTargetRoot` 长期落点、取消清理，并加了回归护栏
   （转交成功后断言 `existsSync(dir)`）。

2. **裸标识必须补默认 channel** —— `RegistryHttpClient.resolve()` 在 channel 与 version 都
   缺席时**直接抛 VALIDATION**。而裸标识（`/agent install acme/hello-cloud`）正是主用法。
   补 `DEFAULT_REGISTRY_CHANNEL`（"stable"，复用列举面同一常量）。选择器路径没踩到这坑，
   只因它的标识恒带 `@channel`。

3. **`parseOnlineSourceRef` 不接受裸标识** —— 需自行分两支；`isValidSourceId` 原为私有，
   加了一行 `export`（判定逻辑未改），避免自写第二套字符集与路径穿越规则。

4. **e2e 夹具:Node 的 `URL` 不解码 pathname 里的 `%2F`** —— 由夹具冒烟实测抓到。
   不 `decodeURIComponent` 会让查表恒 miss，表现为「源不存在」，与真 404 无法区分。

### 发现的既有覆盖缺口

CLI 那条被删除的独立 registry 编排**零测试覆盖** —— 删掉它时没有任何用例变红。
已由 `test/cli/install-registry-convergence.test.ts` 补上（含不注入 `Installer` 的端到端档）。

### 证据

- 根 vitest 940 通过 / 2 跳过；packages/server 2432；packages/ui 841；tool-kit 463；protocol 417
- playwright `registry` 5/5 绿（真实 HTTP resolve + bundle，sha384 复核真在验字节）
- playwright `fs`/`install`/`registry` 三 project 117 通过 / 7 跳过
- ⚠ `login` project 5 个失败**为既有失败**：已用 `git stash` 回到改动前基线 + 重建产物复跑，
  同样 5 红，与本 spec 无关。

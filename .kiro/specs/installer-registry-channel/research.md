# Research — installer-registry-channel

实施过程中用**真实运行**取得的事实，以及据此推翻的设计假设。按发现顺序记录。

## 1. `pi install <本地目录>` 只记路径，不拷贝内容（推翻设计的暂存方案）

**做法**：造一个最小 plugin 目录（`package.json` + `index.js`），真跑
`pi install <abs-dir> --no-approve`（pi 0.80.7），再看 pi 的台账。

**结果**：`~/.pi/agent/settings.json` 的 `plugins[]` 里多了一条**指向原目录的相对路径**：

```
"../../../../private/tmp/.../pi-link-probe/myplug"
```

包内容**没有**被拷贝到任何 pi 管辖的目录。运行时从原路径加载。

**推翻了什么**：design 原方案是「plugin 物化到 `os.tmpdir()` 暂存目录 → 交给 pi → `finally` 清理」。
按实测，清理即**让插件失效**（重启后 pi 指向一个不存在的路径），而且 tmp 目录本身会被系统回收。

**改成什么**：
- `RegistryMaterialization` 删除 `stagingRoot` 字段；`dir` 对两种 kind 都是**长期最终位置**；
- 通道选项 `pluginStagingRoot?` → `pluginTargetRoot`（**必填**，避免默默落进 tmp）；
- `Installer` 的 plugin 分支删掉 `finally` 清理；
- 加了一条**回归护栏**（`installer-registry.test.ts`）：转交成功后断言 `existsSync(dir) === true`，
  若将来有人把清理加回来，这条会红。

**副作用与处置**：`PI_HOME` 不被 pi 采纳，探针写进了真实的 `~/.pi/agent/settings.json`。
已用 `pi remove` 还原，复查该文件对探针路径 0 命中。

**顺带确认（Req 3.4）**：正因为 pi 不拷贝，`installFromRegistry` 写进目录的安装回执
`.pi-web-registry.json` 随目录长期存在——plugin 与 agent 一样被回执覆盖，无需额外处理。

## 2. `parseOnlineSourceRef` 不接受裸标识（design 阶段勘察发现）

`packages/server/src/agent-source/online-source-id.ts:69` 要求恰有一个 `@`，对
`acme/hello-cloud`（**正是 `/agent install` 的主用法**）返回 `undefined`。

处置：通道自己分两支——带 `@` 走 `parseOnlineSourceRef`，裸标识整串作 `sourceId`；
字符集与路径穿越校验一律复用 `isValidSourceId`（原为私有，加了一行 `export`，判定逻辑未改），
不自写第二套规则。

## 3. `resolveSource()` 对 registry 形态直接失败 → `Installer` 里的 `via:"registry"` 是死代码

`source-resolver.ts:204` 在判定为 registry 形态时**立即返回** `REGISTRY_NOT_IMPLEMENTED` 失败，
因此 `installer.ts` 里那句 `if (resolved.value.via === "registry")` 永远不可达。

处置：分派改用 `classifySourceForm(spec)`，且**前置于** `resolveSource()`。
额外收益：registry 标识因此不经 `checkAllowlist`——直连来源的 npm scope / git host 白名单
对注册表标识没有意义，不应误拒（Req 6.3）。已加一条单测：给一个什么都不放行的
allowlist，registry 安装仍成功；若分派顺序被写回去，该测必红。

## 4. `manifest.kind` 的取值面

`SignedManifest` 在本仓是 `Readonly<Record<string, unknown>>`（刻意不解析结构），
故读 kind = 读 `manifest["kind"]` 并自行收窄到 `PluginKind` 三值之一。
缺失或非法**一律 `MANIFEST_KIND_UNKNOWN`**，不做任何缺省推断——pi-web 侧缺省 `plugin`、
registry 侧缺省 `agent`，两侧相反，猜必错一半。

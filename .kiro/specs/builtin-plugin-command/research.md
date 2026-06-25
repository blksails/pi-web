# Research Log — builtin-plugin-command

## 发现范围
扩展型特性（在既有命令链 + 扩展安装机制上接线）。结论固化如下。

## 关键发现（事实，附位置）

| 主题 | 结论 | 位置 |
|---|---|---|
| 命令链 | agent 命令经 RPC get_commands → `GET /sessions/:id/commands`（makeCommandsHandler）→ 前端 getCommands → palette；选中后 `onChange("/name ")` 填输入框 → 当 prompt 发送 | `query-routes.ts:88`；`pi-command-palette.tsx:195` |
| RpcSlashCommand | `source: z.enum(["extension","prompt","skill"])` | `packages/protocol/src/rpc/session-state.ts:44` |
| 扩展安装机制 | `extension-management` 已实现但**未挂载**：`createExtensionRoutes(opts)` 产出 4 端点（GET/POST /extensions、DELETE /extensions/:extId、POST /sessions/:id/reload），含白名单/信任落地/管理员门控/审计/pi-cli 子进程 | `packages/server/src/extensions/routes.ts:26-63` |
| 挂载缺口 | `lib/app/pi-handler.ts` 的 routes 数组**未调用 createExtensionRoutes** | `pi-handler.ts` routes 数组 |
| SessionReloader | 接缝 `(session, fragment)=>Promise<void>`，默认实现 reject；重启编排归宿主注入 | `extensions/ext.types.ts:89`；`reload-session.ts:34` |
| runner 重启能力 | **`PiRpcProcess.requestRestart()` 存在**（dev 热重载用，重 spawn 子进程续同一会话 id/env → 重解析资源）；watcher 在 `hot-reload.ts` | `pi-rpc-process.ts:198`；`hot-reload.ts:20,65` |
| 面板/分派切点 | palette `select(cmd)` 是分派切点；slot/ui-surface 复用 web-ext 保留插槽（dialogLayer 等） | `pi-command-palette.tsx`；`extension-slots.tsx` |
| tool-kit 声明层 | `ToolSpec` 纯声明在 index.ts、runtime handler 在 /runtime（双层范式可复刻） | `packages/tool-kit/src/index.ts` |

## 综合决策

1. **复用 extension-management 端点**：`/plugin install/uninstall/list` 直接打 `/extensions`，不新建通用 execute 端点；本 spec 补「挂载 + SessionReloader 实现」两缺口。
2. **SessionReloader 经 requestRestart**：宿主注入 `(session)=>session.restartRunner()`；在 `PiSession` 上新增薄方法转发 `channel.requestRestart()`。
3. **BuiltinCommandSpec 放 tool-kit**：纯声明导出（像 AIGC_TOOLS）；client/server 各按 name 绑定 handler。
4. **分派切点 palette.select**：source=builtin → 按 target 走 client handler / 调 /extensions 端点 / 开面板；其余 source 不变。
5. **协议向后兼容**：source 枚举 +"builtin"，结构不变。

## 风险
- 改注入路由/配置域后 dev 需重启（handler 单例 pin globalThis，端口 3010）。
- requestRestart 续会话语义需实测（装后是否真重解析到新扩展）——e2e/stub 验证。
- 面板 ui-surface 在裸 dev 的挂载门控（参考 webext artifact base-url 坑）。

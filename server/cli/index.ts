/**
 * pi-web CLI 子命令实现入口(spec cli-package-commands,任务 1.1,Req 10.6)。
 *
 * 这是第二个 esbuild 单文件产物(`dist/cli-commands.mjs`)的构建入口 —— 与
 * `server/index.ts` → `dist/server.mjs` 同级,同样落在**产物根**。`bin/pi-web.mjs`
 * 对非 `run` 意图(create/install/uninstall/list/update/publish)会动态 `import()`
 * 该产物,复用后端已有的校验与编译逻辑,免于在薄启动器里重复实现。
 *
 * 本任务只建立构建接缝与最小骨架:真正的子命令分发(`runSubcommand`)与各子域实现
 * (scaffold/install/publish/registry)留给后续任务。此处先导出一个可被动态加载并
 * 调用的占位函数,验证「产物存在 + 可被 CLI 壳 import 并调用其导出」这条接缝成立。
 */

/**
 * 占位导出,证明本产物可被 `import()` 并调用其导出函数。
 * 后续任务(2.x 起)将替换为真正的 `runSubcommand(name, argv, ctx)` 分发入口。
 */
export function cliCommandsEntryReady(): true {
  return true;
}

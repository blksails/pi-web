/**
 * bin/pi-web.mjs 的环境类型声明(spec pi-web-desktop task 3.1)。
 *
 * 该 CLI 启动器是无类型的纯 JS(.mjs);桌面 main 经 esbuild **构建期内联**复用其纯函数。
 * 用通配 `declare module` 给这些复用函数补类型,使 tsc 通过而 esbuild 正常解析真实实现。
 * 仅声明桌面壳实际复用的导出。
 */
declare module "*/bin/pi-web.mjs" {
  export function findFreePort(
    host: string,
    startPort: number,
    maxTries?: number,
  ): Promise<number | undefined>;

  export function waitForReady(
    host: string,
    port: number,
    signal?: { readonly aborted: boolean },
  ): Promise<void>;

  export function standaloneServerJs(): string;

  export interface BuildEnvOpts {
    readonly source?: string | undefined;
    readonly cwd?: string | undefined;
    readonly host?: string | undefined;
    readonly port?: number | undefined;
    readonly agentDir?: string | undefined;
    readonly stub?: boolean | undefined;
    readonly watch?: boolean | undefined;
  }
  export function buildEnv(
    opts: BuildEnvOpts,
    baseCwd: string,
    baseEnv: NodeJS.ProcessEnv,
  ): NodeJS.ProcessEnv;
}

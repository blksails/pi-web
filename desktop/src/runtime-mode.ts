/**
 * 桌面壳运行模式判定(spec pi-web-desktop task 2.1,Req 8.1/8.2/8.3)。
 *
 * 明确开关、不猜测:以「是否打包态」为主判据,叠加显式开发开关。
 * - dev:未打包 且 设置了非空 `PI_WEB_DESKTOP_DEV_URL` → 加载该开发地址,不拉起 standalone
 *   (保留前端热更新;Req 8.1/8.2)。
 * - packaged:`app.isPackaged` 为真 → 从随包资源目录拉起 standalone(Req 3.3)。
 * - unpackaged:未打包且无 dev url(直跑构建产物)→ 用 CLI 布局的 standalone 入口。
 *   这是 e2e 与本地非打包运行路径。
 */
export type RuntimeMode =
  | { readonly kind: "packaged" }
  | { readonly kind: "unpackaged" }
  | { readonly kind: "dev"; readonly devUrl: string };

/**
 * @param env 进程环境(注入以便测试;生产传 process.env)
 * @param isPackaged Electron 的 app.isPackaged(注入以便测试)
 */
export function resolveRuntimeMode(
  env: NodeJS.ProcessEnv,
  isPackaged: boolean,
): RuntimeMode {
  const devUrl = env.PI_WEB_DESKTOP_DEV_URL?.trim();
  if (!isPackaged && devUrl !== undefined && devUrl.length > 0) {
    return { kind: "dev", devUrl };
  }
  if (isPackaged) return { kind: "packaged" };
  return { kind: "unpackaged" };
}

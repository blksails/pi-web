/**
 * 桌面壳自述标记(spec: desktop-account-login,Req 11/12)。
 *
 * 由 `desktop/src-tauri/src/server_supervisor.rs` 的 `build_child_env` 写入。
 * 只有壳知道自己是壳 —— 这个事实没有别的地方能产生。
 *
 * 两处消费:
 *  - 随包固化的云端默认地址(`lib/app/cloud-defaults.ts`)只在此标记下生效
 *  - 凭据交接帧(`credential-handoff.ts`)只在此标记下发出
 *
 * 单独成文件是为了**单一事实源**:server 包与 app 层都要用它,若各写一份字符串,
 * 改名时必然漏掉一处,而漏掉的后果是静默失效(功能不生效且无报错)。
 */
export const DESKTOP_MARKER_ENV = "PI_WEB_DESKTOP";

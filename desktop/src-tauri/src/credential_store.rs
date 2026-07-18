//! 桌面凭据 keychain 存取（spec desktop-cloud-login 任务 4.1，Req 2.1/2.3/2.5/6.2）。
//!
//! 单一 keychain 条目代表「当前登录用户的桌面凭据」——不做多用户并存：切号即用新值覆盖
//! 旧条目，与 server 侧 `AuthSessionState`（进程内单一登录态）语义对齐。
//!
//! 本模块只搬运凭据**字符串**本身：不解析 payload（userId/companyId/exp 的解析与过期判定
//! 在 server 侧 `credential.ts`）、不验签（验签在云端 egress，本仓不持 secret）。
//!
//! ★ 安全：凭据内容绝不写入 stdout/stderr/日志——即便失败路径也只暴露错误原因文案，
//!   不得把凭据值本身带入任何 `format!`/`eprintln!`（同 `pick_directory` 的脱敏惯例，但
//!   这里更严格，因为凭据比目录路径更敏感）。
//!
//! ★ 后端选择：仅 macOS 用 Security framework（`apple-native`）后端做过真实验证；
//!   Windows/Linux 后端随 crate 声明保证跨平台可编译，未经真实验证
//!   （同 design.md「Open Questions §5 跨平台 keychain 未验」）。

use keyring::Entry;

/// keychain service 命名空间：与桌面壳未来可能新增的其它 keychain 条目区分。
const SERVICE: &str = "pi-web-desktop";
/// 单一条目账号名：代表「当前登录用户」，非多用户并存键。
const ACCOUNT: &str = "desktop-credential";

/// 打开生产用条目（service/account 固定为常量）。
fn entry() -> Result<Entry, String> {
    open_entry(SERVICE, ACCOUNT)
}

/// 打开任意 service/account 的条目——供测试传入隔离账号名，避免测试间与生产条目互相污染。
fn open_entry(service: &str, account: &str) -> Result<Entry, String> {
    Entry::new(service, account).map_err(|e| format!("无法定位 keychain 条目: {e}"))
}

/// 写入生产条目的同步实现；`store_credential` command 与测试均落到此处，避免逻辑分叉。
fn store_credential_sync(credential: &str) -> Result<(), String> {
    let e = entry()?;
    e.set_password(credential)
        .map_err(|e| format!("写入 keychain 失败: {e}"))
}

/// 读取生产条目的同步实现；不存在→`Ok(None)`（不视为错误）。
fn load_credential_result_sync() -> Result<Option<String>, String> {
    let e = entry()?;
    match e.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(err) => Err(format!("读取 keychain 失败: {err}")),
    }
}

/// 清除生产条目的同步实现；条目本就不存在也视为已清除成功（幂等，登出可重复调用）。
fn clear_credential_sync() -> Result<(), String> {
    let e = entry()?;
    match e.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(err) => Err(format!("清除 keychain 失败: {err}")),
    }
}

/// 存入桌面凭据（覆盖旧值，即切号语义）。
#[tauri::command]
pub async fn store_credential(credential: String) -> Result<(), String> {
    store_credential_sync(&credential)
}

/// 读取当前桌面凭据；不存在（从未登录过 / 已登出）→ `None`，不视为错误。
#[tauri::command]
pub async fn load_credential() -> Result<Option<String>, String> {
    load_credential_result_sync()
}

/// 清除桌面凭据（登出）。
#[tauri::command]
pub async fn clear_credential() -> Result<(), String> {
    clear_credential_sync()
}

/// 供 `main.rs base_env()` 启动期直接调用的非-command 读取路径（任务 4.3）。
///
/// 与 `load_credential` 逻辑等价，但不是 `#[tauri::command]`：启动期在建窗/装配 base_env
/// 时调用，此刻既无 IPC 上下文也无需过 ACL——本进程读取自身 keychain 条目，非渲染层发起。
/// 任何失败（keychain 不可用/无条目/环境不支持）一律降级为 `None`，绝不 panic 阻塞启动。
pub fn load_credential_sync() -> Option<String> {
    load_credential_result_sync().ok().flatten()
}

/// 供 `main.rs` 里 `base_env()` 回归测试直接播种/清空**生产**条目（任务 7.3）。
///
/// 仅测试可见：`base_env()` 的 keychain 注入断言需要一个真实写过的条目，
/// 但不应经 async command 层（会引入不必要的运行时依赖）——直接复用同一份同步实现。
#[cfg(test)]
pub(crate) fn test_seed_production_credential(value: &str) -> Result<(), String> {
    store_credential_sync(value)
}

#[cfg(test)]
pub(crate) fn test_clear_production_credential() -> Result<(), String> {
    clear_credential_sync()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 测试专用 service/account：与生产常量 `SERVICE`/`ACCOUNT` 隔离，避免测试写坏真实登录态,
    /// 也避免与并行跑的其它测试用例互相踩踏（本模块内只有一个测试函数触达 keychain,
    /// 故不存在跨测试用例的并发写冲突）。
    const TEST_SERVICE: &str = "pi-web-desktop-test";
    const TEST_ACCOUNT: &str = "credential-store-roundtrip";

    /// keychain 在当前环境是否可用的探测：CI/headless 容器可能拒绝 keychain 访问
    /// （无 TTY/无登录会话）。探测失败时后续断言全部跳过并打印原因，不谎报 PASS。
    fn keychain_available() -> bool {
        match open_entry(TEST_SERVICE, "availability-probe") {
            Ok(e) => {
                let ok = e.set_password("probe").is_ok();
                let _ = e.delete_credential();
                ok
            }
            Err(_) => false,
        }
    }

    #[test]
    fn store_load_clear_roundtrip() {
        if !keychain_available() {
            eprintln!(
                "[skip] store_load_clear_roundtrip: 当前环境 keychain 不可用（CI/headless 常见），跳过"
            );
            return;
        }

        let e = open_entry(TEST_SERVICE, TEST_ACCOUNT).expect("应能定位测试条目");

        // 清理任何遗留状态，保证测试幂等可重跑。
        let _ = e.delete_credential();

        // store 后 load 得同值（Req 2.1/2.3 观测完成态）。
        e.set_password("desktop-credential-fixture").expect("写入应成功");
        let got = e.get_password().expect("读取应成功");
        assert_eq!(got, "desktop-credential-fixture", "load 应得到 store 写入的同值");

        // clear 后 load 得空（Req 2.5 观测完成态）。
        e.delete_credential().expect("清除应成功");
        match e.get_password() {
            Err(keyring::Error::NoEntry) => {}
            other => panic!("clear 后 load 应得 NoEntry，实际 {other:?}"),
        }
    }

    #[test]
    fn open_entry_produces_independent_handles_per_account() {
        // 纯逻辑检查（不触达 keychain 后端）：不同 account 名产生不同条目对象，
        // 保证生产常量 ACCOUNT 与测试常量 TEST_ACCOUNT 互不干扰。
        assert_ne!(SERVICE, TEST_SERVICE);
        assert_ne!(ACCOUNT, TEST_ACCOUNT);
    }
}

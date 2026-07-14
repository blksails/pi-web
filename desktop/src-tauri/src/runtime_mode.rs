//! 运行模式判定（spec electron-to-tauri 任务 1.3，Req 1.1/1.2/1.3）。
//!
//! 明确开关、不猜测：以「是否打包态」为主判据，叠加显式开发开关。
//! - dev：未打包 且 设置了非空 `PI_WEB_DESKTOP_DEV_URL` → 加载该开发地址，**不拉起后端**
//!   （保留前端热更新）。
//! - packaged：打包态 → 从随包资源目录拉起后端。
//! - unpackaged：未打包且无 dev url（直跑构建产物）→ 用构建产物布局的入口。这是 e2e 与
//!   本地非打包运行路径。

use crate::types::RuntimeMode;

/// 开发地址环境变量名（与 Electron 壳保持一致，既有脚本无缝迁移）。
pub const DEV_URL_ENV: &str = "PI_WEB_DESKTOP_DEV_URL";

/// 依注入的开发地址与打包标志判定运行模式。
///
/// `dev_url` 为环境变量原值（`None` 表示未设置）；仅空白字符视同未设置。
/// `is_packaged` 生产由 `main` 传入 `!cfg!(dev)`；注入以便单测。
pub fn resolve_runtime_mode(dev_url: Option<&str>, is_packaged: bool) -> RuntimeMode {
    if !is_packaged {
        if let Some(raw) = dev_url {
            let trimmed = raw.trim();
            if !trimmed.is_empty() {
                return RuntimeMode::Dev { dev_url: trimmed.to_string() };
            }
        }
    }
    if is_packaged { RuntimeMode::Packaged } else { RuntimeMode::Unpackaged }
}

/// 从进程环境读取开发地址后判定（生产入口）。
pub fn resolve_from_env(is_packaged: bool) -> RuntimeMode {
    let dev_url = std::env::var(DEV_URL_ENV).ok();
    resolve_runtime_mode(dev_url.as_deref(), is_packaged)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpackaged_with_dev_url_is_dev() {
        assert_eq!(
            resolve_runtime_mode(Some("http://localhost:3010"), false),
            RuntimeMode::Dev { dev_url: "http://localhost:3010".into() }
        );
    }

    #[test]
    fn packaged_takes_precedence_over_dev_url() {
        // 打包态即便设了 dev url 也不得走 dev 分支（防止分发出去的应用连开发服务器）。
        assert_eq!(resolve_runtime_mode(Some("http://localhost:3010"), true), RuntimeMode::Packaged);
    }

    #[test]
    fn unpackaged_without_dev_url_is_unpackaged() {
        assert_eq!(resolve_runtime_mode(None, false), RuntimeMode::Unpackaged);
    }

    #[test]
    fn blank_dev_url_is_not_dev() {
        assert_eq!(resolve_runtime_mode(Some("   "), false), RuntimeMode::Unpackaged);
        assert_eq!(resolve_runtime_mode(Some(""), false), RuntimeMode::Unpackaged);
    }

    #[test]
    fn dev_url_is_trimmed() {
        assert_eq!(
            resolve_runtime_mode(Some("  http://localhost:3010\n"), false),
            RuntimeMode::Dev { dev_url: "http://localhost:3010".into() }
        );
    }
}

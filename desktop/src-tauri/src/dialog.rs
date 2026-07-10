//! 原生目录选择能力桥（spec electron-to-tauri 任务 5.1，Req 6.2–6.6/8.3/8.4/8.5）。
//!
//! 渲染层唯一可触达的「文件系统相关」宿主能力。契约：
//! - 仅回传被选目录的**绝对路径字符串**；返回类型 `Option<String>` 静态保证不回传目录内容、
//!   文件列表或任何 fs 元数据（Req 6.6）。
//! - 取消 / 无选择 / 异常 → 一律「无结果」，**不使 IPC reject**（Req 6.4/6.5）；异常记 stderr。
//!
//! ★ 授权：应用**自身**的 command 被远端来源（回环 UI）调用时，必须在
//!   `permissions/pick-directory.toml` 声明 `allow-pick-directory` 并加入 capability，
//!   否则被 ACL 拒绝（报 `pick_directory not allowed. Plugin not found`）。
//!   渲染层**不**授予 `dialog:allow-open` —— 对话框由 Rust 侧调用。
//!
//! ★ 可测接缝：读到非空 `PI_WEB_DESKTOP_STUB_PICK_DIR` 时直接返回该路径、不弹对话框。
//!   它只改变**对话框来源**，不放宽任何 permission、不改变返回类型、不回传目录内容，
//!   故不构成 Req 8.5 意义上的新增能力。该 env 不出现在任何随包默认环境中。

use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

/// e2e 用的 stub 环境变量：设为非空路径时跳过原生对话框直接返回它。
pub const STUB_PICK_DIR_ENV: &str = "PI_WEB_DESKTOP_STUB_PICK_DIR";

/// 目录选择结果的归一化（纯函数，不依赖 tauri 运行时）。
///
/// 选中 → `Some(绝对路径)`；取消/无选择 → `None`；异常 → `None` 且记 stderr（不抛）。
pub fn normalize_pick_result(result: Result<Option<PathBuf>, String>) -> Option<String> {
    match result {
        Ok(Some(path)) => {
            let s = path.to_string_lossy().into_owned();
            if s.is_empty() {
                None
            } else {
                Some(s)
            }
        }
        Ok(None) => None,
        Err(err) => {
            // 失败即取消语义：降级为无结果，记录到 stderr 供观测（主进程日志，非浏览器面板）。
            eprintln!("[desktop] pick-directory failed: {err}");
            None
        }
    }
}

/// 读取 stub 覆盖（仅非空时生效）。
fn stub_override() -> Option<PathBuf> {
    let raw = std::env::var(STUB_PICK_DIR_ENV).ok()?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

/// 打开系统原生「选择文件夹」对话框。
///
/// 渲染层经 `invoke('pick_directory')` 调用。绝不 reject。
#[tauri::command]
pub async fn pick_directory(app: tauri::AppHandle) -> Option<String> {
    if let Some(stub) = stub_override() {
        return normalize_pick_result(Ok(Some(stub)));
    }

    let (tx, mut rx) = tauri::async_runtime::channel(1);
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.blocking_send(picked);
    });

    let result = match rx.recv().await {
        // 用户选定：FilePath → PathBuf（远端/非文件系统路径无法转换时按「无结果」处理）。
        Some(Some(fp)) => Ok(fp.into_path().ok()),
        // 用户取消。
        Some(None) => Ok(None),
        // 通道关闭（对话框未能回调）：按异常降级。
        None => Err("对话框未返回结果".to_string()),
    };
    normalize_pick_result(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_directory_returns_absolute_path() {
        let got = normalize_pick_result(Ok(Some(PathBuf::from("/Users/x/agents/demo"))));
        assert_eq!(got, Some("/Users/x/agents/demo".to_string()));
    }

    #[test]
    fn cancel_returns_none() {
        assert_eq!(normalize_pick_result(Ok(None)), None);
    }

    #[test]
    fn empty_selection_returns_none() {
        assert_eq!(normalize_pick_result(Ok(Some(PathBuf::from("")))), None);
    }

    #[test]
    fn error_degrades_to_none_without_panic() {
        // Req 6.5：异常不得使 IPC reject，降级为「无结果」。
        assert_eq!(normalize_pick_result(Err("boom".into())), None);
    }

    #[test]
    fn stub_override_requires_non_empty_value() {
        // 该 env 不出现在随包默认环境；空白值视同未设置，走真实对话框分支。
        std::env::set_var(STUB_PICK_DIR_ENV, "   ");
        assert!(stub_override().is_none(), "空白 stub 应视同未设置 → 走真实对话框");
        std::env::set_var(STUB_PICK_DIR_ENV, "/tmp/stubbed");
        assert_eq!(stub_override(), Some(PathBuf::from("/tmp/stubbed")));
        std::env::remove_var(STUB_PICK_DIR_ENV);
        assert!(stub_override().is_none(), "未设置时应走真实对话框");
    }
}

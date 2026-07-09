//! 启动失败的可读呈现（spec electron-to-tauri 任务 1.5，Req 3.1/3.2/3.3/3.4）。
//!
//! 纯函数：把判别式启动错误映射为可读标题 + 详情。这是唯一把错误**类型**翻成**文案**的
//! 地方；错误页只消费文案，不解析类型。

use crate::types::ServerStartError;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct StartupErrorText {
    pub title: String,
    pub detail: String,
}

/// 三类启动错误 → 可读文案。
pub fn describe_startup_error(error: &ServerStartError) -> StartupErrorText {
    match error {
        ServerStartError::NoFreePort { tried_from } => StartupErrorText {
            title: "无法启动：端口不可用".into(),
            detail: format!(
                "本地服务器找不到可用端口（从 {tried_from} 起的一段范围均被占用）。\n\
                 请关闭占用端口的程序后重试。"
            ),
        },
        ServerStartError::EarlyExit { code, stderr_tail } => {
            let code_part = match code {
                Some(c) => format!("退出码 {c}"),
                None => "未知退出码".to_string(),
            };
            let tail = stderr_tail.trim();
            // 无 stderr 时仍须产出可读文案，不得出现空描述（Req 3.4）。
            let tail_part = if tail.is_empty() {
                String::new()
            } else {
                format!("\n\n错误输出：\n{tail}")
            };
            StartupErrorText {
                title: "本地服务器启动失败".into(),
                detail: format!("本地服务器在就绪前退出（{code_part}）。{tail_part}"),
            }
        }
        ServerStartError::ReadyTimeout { timeout_ms } => StartupErrorText {
            title: "启动超时".into(),
            detail: format!(
                "本地服务器在 {} 秒（{timeout_ms}ms）内未就绪。\n\
                 请重试；若反复超时，可能是本机资源紧张或产物损坏。",
                (*timeout_ms as f64 / 1000.0).round() as u64
            ),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_free_port_mentions_start_port() {
        let t = describe_startup_error(&ServerStartError::NoFreePort { tried_from: 3000 });
        assert!(t.detail.contains("3000"), "详情应含端口起点: {}", t.detail);
        assert!(!t.title.is_empty());
    }

    #[test]
    fn early_exit_mentions_code_and_stderr() {
        let t = describe_startup_error(&ServerStartError::EarlyExit {
            code: Some(1),
            stderr_tail: "MODULE_NOT_FOUND: next".into(),
        });
        assert!(t.detail.contains("退出码 1"), "详情应含退出码: {}", t.detail);
        assert!(t.detail.contains("MODULE_NOT_FOUND"), "详情应含 stderr 尾部: {}", t.detail);
    }

    #[test]
    fn early_exit_without_stderr_is_still_readable() {
        // Req 3.4：无任何 stderr 输出时仍须可读，不得出现空描述或悬空的「错误输出：」段。
        let t = describe_startup_error(&ServerStartError::EarlyExit {
            code: None,
            stderr_tail: "   \n ".into(),
        });
        assert!(!t.detail.trim().is_empty());
        assert!(t.detail.contains("未知退出码"));
        assert!(!t.detail.contains("错误输出"), "无 stderr 时不应出现空的错误输出段");
    }

    #[test]
    fn ready_timeout_mentions_duration() {
        let t = describe_startup_error(&ServerStartError::ReadyTimeout { timeout_ms: 60_000 });
        assert!(t.detail.contains("60"), "详情应含等待秒数: {}", t.detail);
        assert!(t.detail.contains("60000"), "详情应含毫秒原值: {}", t.detail);
    }
}

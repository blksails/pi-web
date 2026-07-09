//! 外链打开决策（spec electron-to-tauri 任务 1.4，Req 7.1/7.2/7.3/7.4）。
//!
//! 纯函数，不依赖 tauri：窗口的导航/新窗拦截据此决定把外部链接交系统默认浏览器
//! （`OpenExternal`）还是仅拒绝（`Deny`）。**先校验 scheme 与 host** —— 只有非回环的
//! http/https 才外开；其余（非 http(s) scheme、回环本地 UI、非法 url）一律 Deny，
//! 防止把不受信输入交给系统 opener（可致命令执行），以及为本地 UI 自身另开系统浏览器。

use crate::types::ExternalOpenDecision;
use url::{Host, Url};

/// 判定一个链接是否应交由系统默认浏览器打开。
pub fn decide_external_open(raw_url: &str) -> ExternalOpenDecision {
    let Ok(url) = Url::parse(raw_url) else {
        // 非法 URL：拒绝，且不 panic。
        return ExternalOpenDecision::Deny;
    };
    if url.scheme() != "http" && url.scheme() != "https" {
        return ExternalOpenDecision::Deny;
    }
    match url.host() {
        // IPv4 回环整段 127.0.0.0/8（不止 127.0.0.1）。
        Some(Host::Ipv4(ip)) if ip.is_loopback() => ExternalOpenDecision::Deny,
        Some(Host::Ipv6(ip)) if ip.is_loopback() => ExternalOpenDecision::Deny,
        // `localhost` 由 url crate 归一化为 Domain。
        Some(Host::Domain(d)) if d.eq_ignore_ascii_case("localhost") => ExternalOpenDecision::Deny,
        Some(_) => ExternalOpenDecision::OpenExternal,
        // http(s) 无 host 属畸形（如 `http:///x`）：拒绝。
        None => ExternalOpenDecision::Deny,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ExternalOpenDecision::{Deny, OpenExternal};

    #[test]
    fn external_https_is_opened() {
        assert_eq!(decide_external_open("https://example.com/docs"), OpenExternal);
        assert_eq!(decide_external_open("http://example.com"), OpenExternal);
        assert_eq!(decide_external_open("https://github.com/a/b?x=1#f"), OpenExternal);
    }

    #[test]
    fn loopback_is_denied() {
        // 本地 UI 自身不得被另开进系统浏览器。
        assert_eq!(decide_external_open("http://127.0.0.1:3000/session/1"), Deny);
        assert_eq!(decide_external_open("http://localhost:3000/"), Deny);
        assert_eq!(decide_external_open("http://LOCALHOST:3000/"), Deny);
        // IPv6 字面量：url crate 归一化后 hostname 为 `[::1]`，须按 Ipv6 分支识别。
        assert_eq!(decide_external_open("http://[::1]:3000/"), Deny);
        // 127.0.0.0/8 整段都是回环。
        assert_eq!(decide_external_open("http://127.0.0.2:8080/"), Deny);
    }

    #[test]
    fn non_http_scheme_is_denied() {
        // 不把不受信输入交给系统 opener。
        assert_eq!(decide_external_open("file:///etc/passwd"), Deny);
        assert_eq!(decide_external_open("javascript:alert(1)"), Deny);
        assert_eq!(decide_external_open("data:text/html,<script>x</script>"), Deny);
        assert_eq!(decide_external_open("ftp://example.com/x"), Deny);
    }

    #[test]
    fn malformed_url_is_denied_without_panic() {
        assert_eq!(decide_external_open("not a url"), Deny);
        assert_eq!(decide_external_open(""), Deny);
        assert_eq!(decide_external_open("http://"), Deny);
        assert_eq!(decide_external_open("://x"), Deny);
    }
}

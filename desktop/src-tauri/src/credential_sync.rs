//! 从本地 server 取回凭据并落钥匙串（spec desktop-account-login，Req 12；方案 A）。
//!
//! 渲染层登录成功后 `invoke("sync_credential")`——**调用里不带凭据**，只是个信号。
//! 壳随即带 token 打 `GET /api/desktop/credential`，拿到凭据写钥匙串。
//! 凭据因此全程不经过渲染层（Req 12.5）。
//!
//! ## 为什么手写 HTTP 而不引 reqwest
//!
//! 这是一个**固定的回环、明文、单次、小响应**的请求。引 `reqwest` 会带进一整套
//! TLS/连接池/重定向的 API 面，全部用不上；手写三十行反而更容易审。
//!
//! ## ★ 脱敏
//!
//! 凭据与 token **绝不**进入任何 `format!`/日志/错误文案。失败只回类别性描述——
//! 这条比 `credential_store` 更要紧，因为这里同时经手两样敏感材料。

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

/// 回环请求超时。壳与 server 在同一台机器上，超过 5s 基本等于对端已死。
const TIMEOUT: Duration = Duration::from_secs(5);

/// 取回结果:`Some(cred)` = 已登录;`None` = 未登录/已过期(壳据此清钥匙串)。
pub type FetchResult = Result<Option<String>, String>;

/// 解析响应:剥 HTTP 头 → 取 body → 读 `credential` 字段。
///
/// 单独成函数是为了能在**不起网络**的情况下单测——这段解析正是最容易写错的部分。
pub fn parse_response(raw: &str) -> FetchResult {
    let mut parts = raw.splitn(2, "\r\n\r\n");
    let head = parts.next().unwrap_or("");
    let body = parts.next().unwrap_or("");
    let status = head
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .and_then(|c| c.parse::<u16>().ok())
        .ok_or_else(|| "响应缺少状态行".to_string())?;
    if status == 401 {
        // token 不符——通常意味着 server 与壳不是同一次启动配起来的。
        return Err("凭据端点拒绝了壳 token".into());
    }
    if !(200..300).contains(&status) {
        return Err(format!("凭据端点返回 {status}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(body).map_err(|_| "凭据端点响应不是 JSON".to_string())?;
    match v.get("credential") {
        Some(serde_json::Value::String(s)) if !s.trim().is_empty() => Ok(Some(s.trim().into())),
        // null / 缺失 = 未登录。这**不是**错误(见 shell-credential-route.ts 纪律 3)。
        _ => Ok(None),
    }
}

/// 打 `GET http://127.0.0.1:{port}/api/desktop/credential`。
pub fn fetch_credential(port: u16, token: &str) -> FetchResult {
    let addr = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect(&addr).map_err(|_| "无法连接本地 server".to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).ok();
    stream.set_write_timeout(Some(TIMEOUT)).ok();
    let req = format!(
        "GET /api/desktop/credential HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {token}\r\nAccept: application/json\r\nConnection: close\r\n\r\n"
    );
    stream
        .write_all(req.as_bytes())
        .map_err(|_| "发送凭据请求失败".to_string())?;
    let mut raw = String::new();
    stream
        .read_to_string(&mut raw)
        .map_err(|_| "读取凭据响应失败".to_string())?;
    parse_response(&raw)
}

/// 开发态外置 server 不由壳 supervisor 拉起；从钥匙串恢复登录时直接回灌其内存态。
pub fn seed_credential(port: u16, credential: &str) -> Result<(), String> {
    let addr = format!("127.0.0.1:{port}");
    let mut stream = TcpStream::connect(&addr).map_err(|_| "无法连接本地 server".to_string())?;
    stream.set_read_timeout(Some(TIMEOUT)).ok();
    stream.set_write_timeout(Some(TIMEOUT)).ok();
    let body = serde_json::to_vec(&serde_json::json!({ "credential": credential }))
        .map_err(|_| "无法编码凭据请求".to_string())?;
    let head = format!(
        "POST /api/auth/session HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\
         Content-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream
        .write_all(head.as_bytes())
        .and_then(|_| stream.write_all(&body))
        .map_err(|_| "发送凭据请求失败".to_string())?;
    let mut raw = String::new();
    stream
        .read_to_string(&mut raw)
        .map_err(|_| "读取凭据响应失败".to_string())?;
    let status = raw
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| "响应缺少状态行".to_string())?;
    if (200..300).contains(&status) {
        Ok(())
    } else {
        Err(format!("凭据回灌端点返回 {status}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resp(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\n\r\n{body}")
    }

    #[test]
    fn parses_credential() {
        let r = parse_response(&resp("200 OK", r#"{"credential":"  tok-abc  "}"#)).unwrap();
        assert_eq!(r.as_deref(), Some("tok-abc"), "应 trim 后取出");
    }

    #[test]
    fn null_credential_means_logged_out_not_error() {
        // ★ 这一条决定了登出后钥匙串会不会残留:null 必须被当成「清掉」，不是「出错了别动」。
        assert_eq!(parse_response(&resp("200 OK", r#"{"credential":null}"#)).unwrap(), None);
        assert_eq!(parse_response(&resp("200 OK", "{}")).unwrap(), None);
        assert_eq!(parse_response(&resp("200 OK", r#"{"credential":"   "}"#)).unwrap(), None);
    }

    #[test]
    fn rejects_401_and_non_2xx() {
        assert!(parse_response(&resp("401 Unauthorized", "{}")).is_err());
        assert!(parse_response(&resp("500 Internal Server Error", "{}")).is_err());
        assert!(parse_response(&resp("404 Not Found", "")).is_err());
    }

    #[test]
    fn rejects_malformed() {
        assert!(parse_response("garbage").is_err(), "无状态行");
        assert!(parse_response(&resp("200 OK", "not json")).is_err());
    }

    #[test]
    fn error_text_never_contains_credential_or_token() {
        // 脱敏纪律的机械守卫:失败文案里不得夹带任何敏感材料。
        let err = parse_response(&resp("500 Internal Server Error", r#"{"credential":"SECRET"}"#))
            .unwrap_err();
        assert!(!err.contains("SECRET"), "错误文案不得含凭据");
    }
}

//! 壳凭据取回 token（spec desktop-account-login，Req 12；方案 A）。
//!
//! 每次**进程启动**生成一个强随机 token，经子进程 env `PI_WEB_SHELL_TOKEN` 下发给 server；
//! 壳向 `/api/desktop/credential` 取凭据时以 `Authorization: Bearer` 出示。
//!
//! ★ 为什么必须强随机：这个 token 是该端点**唯一**的门。可预测的 token（时间戳/pid 拼接）
//!   等于没有门——本机任何进程都能算出来。故用 `getrandom`（OS 熵源）而非自造。
//!
//! ★ 为什么每次启动重生成而不持久化：它没有任何跨启动的价值，而持久化就意味着要找地方存，
//!   又多一个可被读取的落点。进程内存活即可。
//!
//! ★ token **绝不**进日志/错误文案。它不是凭据本身，但拿到它就能换到凭据。

use std::sync::OnceLock;

static TOKEN: OnceLock<String> = OnceLock::new();

/// 本次进程的取回 token（首次调用时生成，之后恒定）。
pub fn shell_token() -> &'static str {
    TOKEN.get_or_init(|| {
        let mut bytes = [0u8; 32];
        // 失败即 panic 是刻意的：拿不到 OS 熵源时**不得**退化成弱随机——
        // 那会让端点在用户毫不知情的情况下变成敞开的。宁可起不来。
        getrandom::getrandom(&mut bytes).expect("无法获取系统熵源以生成 shell token");
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_is_stable_within_process() {
        assert_eq!(shell_token(), shell_token(), "同一进程内 token 必须恒定");
    }

    #[test]
    fn token_is_long_hex() {
        let t = shell_token();
        assert_eq!(t.len(), 64, "32 字节十六进制 = 64 字符");
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()), "只应含十六进制字符");
        // 全零意味着熵源没生效（或被 mock 掉）——那是这个 token 最危险的失败形态。
        assert_ne!(t, "0".repeat(64), "token 不得为全零");
    }
}

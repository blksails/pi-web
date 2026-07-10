//! 共享运行时的解包接缝（spec shared-runtime-payload 任务 5.3）。
//!
//! ★ 本模块**不实现解包**。解包语义只有一份，在 `payload/unpack.mjs` 里。桌面壳已经必须
//!   持有随包 `node`（用来拉起后端），于是用同一个二进制去执行同一个解包器。Rust 只负责
//!   spawn、超时、以及把单行 JSON 翻成判别式错误。
//!
//!   若在 Rust 侧用 `tar` / `zstd` crate 重写一份，「锁该等多久」「什么算损坏」「GC 删什么」
//!   这些判断就会有两份实现并必然漂移。本仓已有前车之鉴：就绪探针的语义靠 design 里的一张
//!   对照表在 `bin/pi-web.mjs` 与 `ready_probe.rs` 之间强行同步。故**不得**新增归档/压缩依赖。
//!
//! 契约：`node unpack.mjs --payload-dir <dir> --json`
//!   - stdout **恰好一行** JSON；诊断信息一律走 stderr
//!   - 成功 `{"ok":true,"serverJs":…,"distRoot":…,"unpacked":…,"runtimeRoot":…,"runtimeDir":…}`
//!   - 失败 `{"ok":false,"code":…,"message":…}`，退出码 1
//!
//! Rust 只消费 `code`，从不解析人类可读的 `message`。

use crate::types::UnpackError;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 解包器在载荷目录中的文件名。
const UNPACKER: &str = "unpack.mjs";

/// 解包成功的落点。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnsureOk {
    pub server_js: PathBuf,
    pub runtime_root: String,
    pub runtime_dir: String,
    pub unpacked: bool,
}

fn err(code: &str, message: impl Into<String>) -> UnpackError {
    UnpackError {
        code: code.to_string(),
        message: message.into(),
    }
}

/// 解析解包器的 stdout（**纯函数**，可脱离进程单测）。
///
/// 取最后一个非空行：node 或其加载的模块偶尔会往 stdout 多写东西，契约只保证**最后一行**
/// 是我们的 JSON。空输出、非 JSON、缺字段一律归为 `extract-failed` —— 那意味着解包器根本
/// 没按契约跑起来（例如入口守卫因符号链接未命中，实测踩过）。
pub fn parse_ensure_output(stdout: &str) -> Result<EnsureOk, UnpackError> {
    let line = stdout
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .next_back()
        .ok_or_else(|| err("extract-failed", "解包器无任何输出"))?;

    let value: serde_json::Value = serde_json::from_str(line)
        .map_err(|e| err("extract-failed", format!("解包器输出不是合法 JSON：{e}")))?;

    if value.get("ok").and_then(serde_json::Value::as_bool) != Some(true) {
        let code = value
            .get("code")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("extract-failed");
        let message = value
            .get("message")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("解包运行时失败");
        return Err(err(code, message));
    }

    let get_str = |k: &str| -> Result<String, UnpackError> {
        value
            .get(k)
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| err("extract-failed", format!("解包器输出缺少字段 {k}")))
    };

    Ok(EnsureOk {
        server_js: PathBuf::from(get_str("serverJs")?),
        runtime_root: get_str("runtimeRoot")?,
        runtime_dir: get_str("runtimeDir")?,
        unpacked: value
            .get("unpacked")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false),
    })
}

/// 确保共享运行时就绪，返回后端入口。
///
/// 子进程**继承父环境**：`PI_WEB_RUNTIME_ROOT` 由此可达（e2e 靠它把运行时指向临时目录），
/// `HOME` 也由此可达（解包器据其推导默认运行时根）。切勿 `env_clear`。
pub fn ensure(node_bin: &Path, payload_dir: &Path) -> Result<EnsureOk, UnpackError> {
    let unpacker = payload_dir.join(UNPACKER);
    if !unpacker.is_file() {
        return Err(err(
            "payload-missing",
            format!("随包解包器缺失：{}", unpacker.display()),
        ));
    }

    let output = Command::new(node_bin)
        .arg(&unpacker)
        .arg("--payload-dir")
        .arg(payload_dir)
        .arg("--json")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()
        .map_err(|e| err("extract-failed", format!("无法执行解包器：{e}")))?;

    // 退出码非 0 时 stdout 仍应带一行 {"ok":false,...}；先解析，拿不到再退回通用错误。
    let stdout = String::from_utf8_lossy(&output.stdout);
    match parse_ensure_output(&stdout) {
        Ok(ok) if output.status.success() => Ok(ok),
        Ok(_) => Err(err(
            "extract-failed",
            format!("解包器报告成功但退出码为 {:?}", output.status.code()),
        )),
        Err(e) => Err(e),
    }
}

/// 触发旧运行时目录的回收。**尽力而为、不等待、失败不报**（Req 5.4/5.5）。
/// 必须在后端进程已拉起之后调用。
pub fn spawn_gc(node_bin: &Path, payload_dir: &Path, runtime_root: &str, keep_dir: &str) {
    let unpacker = payload_dir.join(UNPACKER);
    let spawned = Command::new(node_bin)
        .arg(&unpacker)
        .arg("--gc")
        .arg("--runtime-root")
        .arg(runtime_root)
        .arg("--keep")
        .arg(keep_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
    if let Err(e) = spawned {
        eprintln!("[desktop] 运行时回收未能启动（已忽略）: {e}");
    }
}

/// 判别式错误码 → 用户可读文案。与 `payload/unpack.mjs` 的 `describeErrorCode` 同源。
pub fn describe_unpack_error(err: &UnpackError) -> String {
    let hint = match err.code.as_str() {
        "runtime-root-unwritable" => {
            "运行时目录不可写。请检查该路径的权限，或经 PI_WEB_RUNTIME_ROOT 指定其他位置。"
        }
        "disk-full" => "磁盘空间不足，无法解包运行时。请清理磁盘后重试。",
        "payload-missing" | "payload-corrupt" => "随包运行时载荷缺失或已损坏。请重新安装应用。",
        "zstd-unsupported" => "随包 Node 运行时不支持 zstd 解压。应用可能已损坏，请重新安装。",
        "lock-timeout" => "等待其他进程完成运行时解包超时。请确认没有其他实例卡住，然后重试。",
        _ => "解包运行时失败。",
    };
    format!("{hint}\n\n详情：{}", err.message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_success_line() {
        let out = r#"{"ok":true,"runtimeRoot":"/r","runtimeDir":"0.1.3-abcdef012345","distRoot":"/r/d/dist","serverJs":"/r/d/dist/server.mjs","unpacked":true,"elapsedMs":42}"#;
        let got = parse_ensure_output(out).unwrap();
        assert_eq!(got.server_js, PathBuf::from("/r/d/dist/server.mjs"));
        assert_eq!(got.runtime_dir, "0.1.3-abcdef012345");
        assert!(got.unpacked);
    }

    #[test]
    fn parses_failure_line_and_preserves_code() {
        let out = r#"{"ok":false,"code":"payload-corrupt","message":"摘要不匹配"}"#;
        let e = parse_ensure_output(out).unwrap_err();
        assert_eq!(e.code, "payload-corrupt");
        assert_eq!(e.message, "摘要不匹配");
    }

    #[test]
    fn takes_last_non_empty_line() {
        // 契约只保证最后一行是我们的 JSON；前面的噪声不得干扰。
        let out = "some noise\n\n{\"ok\":true,\"runtimeRoot\":\"/r\",\"runtimeDir\":\"d\",\"serverJs\":\"/s\",\"unpacked\":false}\n\n";
        let got = parse_ensure_output(out).unwrap();
        assert_eq!(got.server_js, PathBuf::from("/s"));
        assert!(!got.unpacked);
    }

    #[test]
    fn empty_output_is_extract_failed() {
        // ★ 实测踩过：解包器入口守卫因符号链接未命中 → main() 不执行 → stdout 为空。
        let e = parse_ensure_output("   \n\n").unwrap_err();
        assert_eq!(e.code, "extract-failed");
    }

    #[test]
    fn garbage_output_is_extract_failed() {
        let e = parse_ensure_output("not json at all").unwrap_err();
        assert_eq!(e.code, "extract-failed");
    }

    #[test]
    fn success_missing_required_field_is_extract_failed() {
        let e = parse_ensure_output(r#"{"ok":true,"runtimeRoot":"/r"}"#).unwrap_err();
        assert_eq!(e.code, "extract-failed");
    }

    #[test]
    fn failure_without_code_falls_back() {
        let e = parse_ensure_output(r#"{"ok":false}"#).unwrap_err();
        assert_eq!(e.code, "extract-failed");
    }

    #[test]
    fn missing_unpacker_reports_payload_missing() {
        let e = ensure(Path::new("/bin/false"), Path::new("/nonexistent-payload")).unwrap_err();
        assert_eq!(e.code, "payload-missing");
    }

    #[test]
    fn describe_covers_every_code() {
        for code in [
            "runtime-root-unwritable",
            "disk-full",
            "payload-missing",
            "payload-corrupt",
            "zstd-unsupported",
            "lock-timeout",
            "extract-failed",
        ] {
            let text = describe_unpack_error(&UnpackError {
                code: code.to_string(),
                message: "m".into(),
            });
            assert!(text.contains("详情：m"), "{code} 的文案未带详情");
            assert!(!text.starts_with("详情"), "{code} 缺少可读提示");
        }
    }
}

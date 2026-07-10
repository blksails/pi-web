//! 端口选取与后端就绪探针（spec electron-to-tauri 任务 1.6，Req 2.1/2.2/2.4/8.2）。
//!
//! ★ 本模块是与 `bin/pi-web.mjs`（CLI）的**唯一契约同步点**。两侧实现分离，语义必须一致；
//!   下列常量与判据即 design 的「就绪与端口契约」表，改动任一侧都须同步另一侧与两侧单测。
//!
//! | 行为 | 取值 |
//! |---|---|
//! | 最大端口尝试次数 | 20 |
//! | 「被占」判据 | TCP connect 成功 |
//! | 「空闲」判据 | connect 出错，或 1000ms 超时 |
//! | 探测主机映射 | `0.0.0.0` / `::` → `127.0.0.1` |
//! | 就绪探测端点 | `GET /` |
//! | 就绪判据 | **任何 HTTP 响应**（不看状态码） |
//! | 轮询间隔 | 300ms |
//! | 总超时 | 60_000ms |
//! | 单次请求超时 | 2_000ms |
//! | 中止条件 | 子进程已退出 → 立即失败 |

use crate::types::ReadyError;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::time::{Duration, Instant};

/// 端口探测的连接超时；超时视为「空闲」（与 CLI 的 `isPortFree` 一致）。
const PORT_PROBE_TIMEOUT: Duration = Duration::from_millis(1000);
/// 就绪轮询间隔。
const READY_POLL: Duration = Duration::from_millis(300);
/// 就绪总超时。
pub const READY_TIMEOUT_MS: u64 = 60_000;
/// 就绪探测的单次请求超时。
const READY_REQUEST_TIMEOUT: Duration = Duration::from_millis(2000);

/// 通配/未指定主机映射为可连接的回环地址（`0.0.0.0`/`::` 不可 connect）。
pub fn probe_host(host: &str) -> &str {
    if host == "0.0.0.0" || host == "::" {
        "127.0.0.1"
    } else {
        host
    }
}

fn resolve_addr(host: &str, port: u16) -> Option<SocketAddr> {
    (host, port).to_socket_addrs().ok()?.next()
}

/// 端口是否空闲：connect 成功=被占(false)；出错或超时=空闲(true)。
fn is_port_free(host: &str, port: u16) -> bool {
    let Some(addr) = resolve_addr(probe_host(host), port) else {
        return false;
    };
    match TcpStream::connect_timeout(&addr, PORT_PROBE_TIMEOUT) {
        Ok(_) => false,
        Err(_) => true,
    }
}

/// 从 `start_port` 起递增探测，返回首个空闲端口；全部被占返回 `None`。
///
/// 端口超过 65535 即停止（不回绕）。
pub fn find_free_port(host: &str, start_port: u16, max_tries: u16) -> Option<u16> {
    for i in 0..max_tries {
        let port = start_port.checked_add(i)?;
        if is_port_free(host, port) {
            return Some(port);
        }
    }
    None
}

/// 发一次 `GET /`，读到**任何** HTTP 响应即算就绪（不看状态码）。
fn probe_once(host: &str, port: u16) -> bool {
    let Some(addr) = resolve_addr(host, port) else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, READY_REQUEST_TIMEOUT) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(READY_REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(READY_REQUEST_TIMEOUT));
    let req = format!("GET / HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\n\r\n");
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = [0u8; 16];
    match stream.read(&mut buf) {
        // 服务器已应答：只要开头是 HTTP 状态行即就绪，不判状态码（500 也算就绪）。
        Ok(n) if n > 0 => buf[..n].starts_with(b"HTTP/"),
        _ => false,
    }
}

/// 轮询直至后端就绪。
///
/// `is_exited` 由调用方注入（读子进程退出状态），使本函数可脱离进程管理单测。
/// 一旦其返回 true，立即以 `Aborted` 失败——不再空等到超时（Req 2.3）。
pub fn wait_for_ready(
    host: &str,
    port: u16,
    timeout_ms: u64,
    is_exited: &dyn Fn() -> bool,
) -> Result<(), ReadyError> {
    let host = probe_host(host);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    loop {
        if is_exited() {
            return Err(ReadyError::Aborted);
        }
        if probe_once(host, port) {
            return Ok(());
        }
        if Instant::now() >= deadline {
            return Err(ReadyError::Timeout { timeout_ms });
        }
        std::thread::sleep(READY_POLL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    /// 起一个最小 HTTP server，对任意请求回固定状态码。返回其端口与停止句柄。
    fn spawn_http(status_line: &'static str) -> (u16, Arc<AtomicBool>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let stop = Arc::new(AtomicBool::new(false));
        let stop_c = stop.clone();
        std::thread::spawn(move || {
            listener.set_nonblocking(true).unwrap();
            while !stop_c.load(Ordering::Relaxed) {
                match listener.accept() {
                    Ok((mut s, _)) => {
                        let mut b = [0u8; 512];
                        let _ = s.read(&mut b);
                        let _ = s.write_all(status_line.as_bytes());
                    }
                    Err(_) => std::thread::sleep(Duration::from_millis(10)),
                }
            }
        });
        (port, stop)
    }

    #[test]
    fn probe_host_maps_wildcards_to_loopback() {
        assert_eq!(probe_host("0.0.0.0"), "127.0.0.1");
        assert_eq!(probe_host("::"), "127.0.0.1");
        assert_eq!(probe_host("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn find_free_port_skips_occupied_and_returns_next() {
        let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = occupied.local_addr().unwrap().port();
        // 从被占端口起找，应跳过它返回后续某个空闲端口。
        let found = find_free_port("127.0.0.1", port, 20).expect("应找到空闲端口");
        assert_ne!(found, port, "不应返回被占端口");
        assert!(found > port);
    }

    #[test]
    fn find_free_port_returns_none_when_all_occupied() {
        // max_tries=1 且该端口被占 → 无可用端口。
        let occupied = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = occupied.local_addr().unwrap().port();
        assert_eq!(find_free_port("127.0.0.1", port, 1), None);
    }

    #[test]
    fn ready_when_server_answers_any_status_including_500() {
        // 契约：**任何 HTTP 响应**即就绪，不看状态码。
        let (port, stop) = spawn_http("HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\n\r\n");
        let r = wait_for_ready("127.0.0.1", port, 5_000, &|| false);
        stop.store(true, Ordering::Relaxed);
        assert_eq!(r, Ok(()), "500 也应判为就绪");
    }

    #[test]
    fn ready_when_server_answers_200() {
        let (port, stop) = spawn_http("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n");
        let r = wait_for_ready("127.0.0.1", port, 5_000, &|| false);
        stop.store(true, Ordering::Relaxed);
        assert_eq!(r, Ok(()));
    }

    #[test]
    fn aborted_when_child_exits() {
        // 子进程已退出 → 立即 Aborted，不空等到超时。
        let free = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = free.local_addr().unwrap().port();
        drop(free);
        let started = Instant::now();
        let r = wait_for_ready("127.0.0.1", port, 60_000, &|| true);
        assert_eq!(r, Err(ReadyError::Aborted));
        assert!(started.elapsed() < Duration::from_secs(2), "应立即返回而非空等");
    }

    #[test]
    fn timeout_when_nothing_listens() {
        let free = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = free.local_addr().unwrap().port();
        drop(free);
        let r = wait_for_ready("127.0.0.1", port, 600, &|| false);
        assert_eq!(r, Err(ReadyError::Timeout { timeout_ms: 600 }));
    }

    #[test]
    fn timeout_when_socket_accepts_but_never_answers() {
        // 连得上但不回 HTTP（挂起的 server）→ 仍应超时，而非误判就绪。
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for s in listener.incoming().flatten() {
                std::thread::sleep(Duration::from_millis(300));
                drop(s);
            }
        });
        let r = wait_for_ready("127.0.0.1", port, 800, &|| false);
        assert_eq!(r, Err(ReadyError::Timeout { timeout_ms: 800 }));
    }
}

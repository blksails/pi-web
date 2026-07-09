//! 桌面壳基础类型（spec electron-to-tauri 任务 1.1）。
//!
//! 启动路径的失败以**判别式类型**建模，而非字符串或异常：`startup_error` 是唯一把
//! 这些类型翻成用户可读文案的地方，错误页只消费文案、不解析类型。

use std::path::PathBuf;

/// 运行模式（`runtime_mode::resolve_runtime_mode` 产出）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RuntimeMode {
    /// 未打包且设置了非空开发地址：加载该地址，**不拉起后端**（保前端热更新）。
    Dev { dev_url: String },
    /// 打包态：从随包资源目录拉起后端。
    Packaged,
    /// 未打包且无开发地址：从构建产物布局拉起后端（e2e 路径）。
    Unpackaged,
}

/// 后端拉起失败的三种判别式形态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerStartError {
    /// 从起始端口起的探测范围内无任何空闲端口；**未曾 spawn 任何进程**。
    NoFreePort { tried_from: u16 },
    /// 后端在就绪前自行退出。
    EarlyExit {
        code: Option<i32>,
        stderr_tail: String,
    },
    /// 后端仍存活但超时未就绪。
    ///
    /// ★ 与 `EarlyExit` 的区分依赖 `server_supervisor` 在收尾**之前**快照进程退出状态。
    ReadyTimeout { timeout_ms: u64 },
}

/// 就绪探针的失败形态（不含端口选取）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReadyError {
    /// 子进程在就绪前退出，探针被中止。
    Aborted,
    /// 超过总超时仍未就绪。
    Timeout { timeout_ms: u64 },
}

/// 后端拉起成功后的落点。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServerStartResult {
    pub url: String,
    pub port: u16,
}

/// 非 dev 模式下解析出的两条路径。
///
/// ★ 二者来源不同，不可混用：`server_js` 来自 `resource_dir()`（macOS 为
/// `Contents/Resources/`），`node_bin` 来自主可执行同目录（macOS 为 `Contents/MacOS/`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactPaths {
    /// 自包含产物入口。**必须位于产物根**——其父目录即子进程 cwd，
    /// 否则 `packages/server` 的路径解析回退失效。
    pub server_js: PathBuf,
    /// 随包 JS 运行时的绝对路径，经 `PI_WEB_NODE_BIN` 下达给 pi runner 孙进程。
    pub node_bin: PathBuf,
}

/// 产物路径解析失败。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolveError {
    /// 打包态拿不到资源目录（属打包/编程错误，非用户可修复）。
    MissingResourceDir,
    /// 未打包态拿不到构建产物入口。
    MissingCliEntry,
    /// 无法定位主可执行文件所在目录，从而推不出随包 node 路径。
    MissingExeDir,
}

/// 外链放行判定结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalOpenDecision {
    /// 交系统默认浏览器打开。
    OpenExternal,
    /// 拒绝：回环地址、非 http(s) scheme、或非法 URL。
    Deny,
}

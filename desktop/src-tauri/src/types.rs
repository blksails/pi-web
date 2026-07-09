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

/// 后端入口的来源。**打包态与未打包态的入口来自截然不同的地方**，故以判别式建模，
/// 而不是让调用方去记「哪种模式下 server_js 是真路径」。
///
/// - `Direct`：入口已是磁盘上的真实路径（dev 不拉后端；unpackaged 直跑构建产物）。
/// - `Payload`：安装包里只有压缩载荷，入口须先解包到共享运行时目录才存在。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerSource {
    /// 未打包态：仓库中已构建的 `dist/server.mjs`。不触发解包。
    Direct(PathBuf),
    /// 打包态：`<resource_dir>/payload/`，含 `dist.tar.zst` / `payload.json` / `unpack.mjs`。
    Payload { payload_dir: PathBuf },
}

/// 非 dev 模式下解析出的两条路径。
///
/// ★ **三条路径来源互不相同，混用任意两条都会在打包态崩溃**，且只有 `desktop-packaged.mjs`
///   能捕获（未打包 e2e 抓不到）：
///   - `node_bin`    ← 主可执行同目录（`bundle.externalBin`），macOS 为 `Contents/MacOS/`
///   - `payload_dir` ← 资源目录（`bundle.resources`），macOS 为 `Contents/Resources/`
///   - 解包出的产物根 ← 用户运行时目录 `~/.pi/web/runtime/<version>-<digest12>/dist/`
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ArtifactPaths {
    /// 后端入口的来源。解包后其入口**必须位于产物根**——父目录即子进程 cwd，
    /// 否则 `packages/server` 的路径解析回退失效。
    pub server_source: ServerSource,
    /// 随包 JS 运行时的绝对路径。既用于执行解包器，也经 `PI_WEB_NODE_BIN` 下达给
    /// pi runner 孙进程。**不随产物迁移到用户运行时目录。**
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

/// 解包共享运行时失败。
///
/// `code` 是与 `payload/unpack.mjs` 之间的**跨进程契约**（判别式错误码）；
/// `message` 只是人类可读的补充，Rust 侧从不解析它。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnpackError {
    pub code: String,
    pub message: String,
}

/// 外链放行判定结果。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExternalOpenDecision {
    /// 交系统默认浏览器打开。
    OpenExternal,
    /// 拒绝：回环地址、非 http(s) scheme、或非法 URL。
    Deny,
}

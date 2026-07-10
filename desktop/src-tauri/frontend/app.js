/**
 * 加载页 / 启动错误页脚本（spec electron-to-tauri 任务 1.1）。
 *
 * 外置而非内联：使页面 CSP 可用 `script-src 'self'`，不必放开 `unsafe-inline`
 * ——被替换的 Electron loading.html 是 `default-src 'none'` 的零脚本页面，
 * 迁移不得放松该基线（Req 8.5）。
 *
 * 本页只**呈现**宿主已翻译好的文案，不解析错误类型。
 */
const $ = (id) => document.getElementById(id);
const invoke = () => window.__TAURI__?.core?.invoke;

function showError(payload) {
  $("loading").classList.add("hidden");
  $("err-title").textContent = payload.title;
  $("err-detail").textContent = payload.detail;
  $("error").classList.add("shown");
}

function showLoading() {
  $("error").classList.remove("shown");
  $("loading").classList.remove("hidden");
}

$("btn-retry").addEventListener("click", async () => {
  $("btn-retry").disabled = true;
  $("btn-quit").disabled = true;
  showLoading();
  try {
    await invoke()?.("retry");
  } finally {
    $("btn-retry").disabled = false;
    $("btn-quit").disabled = false;
  }
});

$("btn-quit").addEventListener("click", () => {
  void invoke()?.("quit");
});

// 宿主经 emit("startup-error", {title, detail}) 切到错误态。
window.__TAURI__?.event?.listen("startup-error", (e) => showError(e.payload));

/**
 * `host:browser` — controlled browser preview.
 *
 * This guest intentionally has no pane capabilities. It only changes a nested sandboxed
 * iframe URL, and only for the host origin or loopback development servers.
 */
import { controlledBrowserOrigins, isControlledBrowserOrigin, normaliseBrowserUrl } from "./policy.js";

function main(): void {
  const root = document.getElementById("root");
  if (root === null) return;
  root.innerHTML = `
    <main class="browser-pane pane" data-testid="browser-pane">
      <form class="browser-toolbar" data-testid="browser-toolbar">
        <button type="button" data-action="back" aria-label="后退">‹</button>
        <button type="button" data-action="forward" aria-label="前进">›</button>
        <button type="button" data-action="reload" aria-label="刷新">↻</button>
        <input data-testid="browser-url" aria-label="网址" autocomplete="url" spellcheck="false"
          placeholder="输入受控网址，例如 http://localhost:3000" />
        <button type="submit" data-testid="browser-open">打开</button>
      </form>
      <div class="browser-status muted" role="status" data-testid="browser-status">
        仅预览 http/https 页面；页面不获得宿主权限。
      </div>
      <section class="browser-content">
        <div class="browser-empty" data-testid="browser-empty">
          <p>输入网址开始预览。</p>
          <p class="muted">仅允许宿主来源与本机开发服务；其他网址可在系统浏览器打开。</p>
          <button type="button" data-action="open-external" hidden>在系统浏览器打开</button>
        </div>
        <iframe title="浏览器预览" data-testid="browser-frame"
          sandbox="allow-forms allow-popups allow-scripts" referrerpolicy="no-referrer"></iframe>
      </section>
    </main>`;

  const form = root.querySelector<HTMLFormElement>("[data-testid=browser-toolbar]");
  const input = root.querySelector<HTMLInputElement>("[data-testid=browser-url]");
  const frame = root.querySelector<HTMLIFrameElement>("[data-testid=browser-frame]");
  const status = root.querySelector<HTMLElement>("[data-testid=browser-status]");
  const empty = root.querySelector<HTMLElement>("[data-testid=browser-empty]");
  const external = root.querySelector<HTMLButtonElement>("[data-action=open-external]");
  if (form === null || input === null || frame === null || status === null || empty === null || external === null) return;
  const origins = controlledBrowserOrigins(document.referrer, window.location.origin);

  const history: string[] = [];
  let historyIndex = -1;
  const setStatus = (message: string): void => { status.textContent = message; };
  const navigate = (raw: string, record = true): void => {
    const url = normaliseBrowserUrl(raw);
    if (url === undefined) {
      external.hidden = true;
      setStatus("网址无效：仅允许 http:// 或 https://，且不含账号密码。");
      return;
    }
    if (!isControlledBrowserOrigin(url, origins)) {
      input.value = url.href;
      empty.hidden = false;
      external.hidden = false;
      external.dataset.url = url.href;
      setStatus("该来源不在受控白名单，仅可在系统浏览器打开。");
      return;
    }
    external.hidden = true;
    if (record) {
      history.splice(historyIndex + 1);
      history.push(url.href);
      historyIndex = history.length - 1;
    }
    input.value = url.href;
    frame.src = url.href;
    empty.hidden = true;
    setStatus(`正在加载 ${url.href}`);
  };

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    navigate(input.value);
  });
  root.querySelector<HTMLButtonElement>("[data-action=back]")?.addEventListener("click", () => {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    navigate(history[historyIndex]!, false);
  });
  root.querySelector<HTMLButtonElement>("[data-action=forward]")?.addEventListener("click", () => {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    navigate(history[historyIndex]!, false);
  });
  root.querySelector<HTMLButtonElement>("[data-action=reload]")?.addEventListener("click", () => {
    if (frame.src.length > 0) frame.contentWindow?.location.reload();
  });
  external.addEventListener("click", () => {
    const url = external.dataset.url;
    if (url !== undefined) window.open(url, "_blank", "noopener,noreferrer");
  });
  frame.addEventListener("load", () => {
    if (empty.hidden) setStatus(`已加载 ${input.value}`);
  });
}

main();

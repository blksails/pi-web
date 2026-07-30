/**
 * surface-demo 的 pane guest(spec panes-only-right-panel 任务 2.2)。
 *
 * ★ 迁移是**等价改写**:全部 testid、`data-surface-available` 标记与降级文案逐字保留 ——
 * 既有 e2e 守的行为一条不少,只是选择器从宿主 realm 换到 iframe 内。
 *
 * ★ 零协议新增。勘察(research.md I4)确认 guest SDK 的 surface 四件套
 * (读快照 / 订阅 / 执行命令 / 探测命令可用性)**已全部具备**,故本次是纯 UI 改写。
 *
 * 用原生 DOM 而非 React:pane 文档是自足 bundle,少一个框架就少约 40KB 内联进宿主产物,
 * 而这个面板只有一个计数、一个按钮和一列日志。
 */
import { connectPaneGuest } from "@blksails/pi-web-panes-kit";

interface DemoSnapshot {
  readonly count: number;
  readonly log: readonly string[];
}

const DOMAIN = "demo";
const STATE_KEY = `surface:${DOMAIN}`;
const PROBE = `surface:${DOMAIN}`;

/** 运行期校验:通道返回值的泛型是断言不是校验,字段缺失时要空态而非崩溃。 */
function readSnapshot(raw: unknown): DemoSnapshot | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const rec = raw as Record<string, unknown>;
  const count = typeof rec.count === "number" ? rec.count : undefined;
  if (count === undefined) return undefined;
  const log = Array.isArray(rec.log) ? rec.log.filter((l): l is string => typeof l === "string") : [];
  return { count, log };
}

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

async function main(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) return;
  const conn = await connectPaneGuest({ expectedPaneId: "demo", window });

  // ★ 每次渲染重算(与迁移前的 React 版一致):grants 虽在建连时冻结,但保持同一语义,
  // 免得将来 grants 变成可更新时这里静默停留在旧值。
  const isAvailable = (): boolean => conn.surface.hasCommand(PROBE);
  let snap = readSnapshot(conn.surface.getState(STATE_KEY));
  let pending = false;
  let lastError: string | undefined;

  const render = (): void => {
    root.replaceChildren();
    const panel = el("div", {
      "data-testid": "surface-demo-panel",
      "data-surface-available": String(isAvailable()),
      style: "padding:12px;display:flex;flex-direction:column;gap:8px",
    });
    panel.appendChild(el("div", { style: "font-size:12px;opacity:.7" }, "Agent 权威 surface · demo"));
    panel.appendChild(
      el("div", { "data-testid": "surface-demo-count", style: "font-size:28px;font-weight:700" },
        snap === undefined ? "—" : String(snap.count)),
    );
    if (isAvailable()) {
      const btn = el("button", {
        type: "button",
        "data-testid": "surface-demo-increment",
        style: `padding:6px 10px;border-radius:6px;border:1px solid hsl(var(--border));background:hsl(var(--muted));cursor:${pending ? "wait" : "pointer"}`,
        ...(pending ? { disabled: "true" } : {}),
      }, "increment(命令)");
      btn.addEventListener("click", () => {
        if (pending) return;
        pending = true;
        render();
        void Promise.resolve(conn.surface.run(DOMAIN, "increment"))
          // ★ 命令失败时**返回 ok:false 而不抛** —— 只 catch 抓不到,必须检查返回值。
          .then((result: unknown) => {
            const r = result as { ok?: boolean; error?: { message?: string } } | undefined;
            lastError = r?.ok === false ? (r.error?.message ?? "command failed") : undefined;
          })
          // ★ 不吞错:命令被拒/宿主未就绪时必须可见,否则表现为「点了没反应」——
          // 那是最难查的一类症状。
          .catch((err: unknown) => { lastError = err instanceof Error ? err.message : String(err); })
          .finally(() => { pending = false; render(); });
      });
      panel.appendChild(btn);
    } else {
      panel.appendChild(
        el("div", { "data-testid": "surface-demo-degraded", style: "font-size:12px;opacity:.6" },
          "surface 不可用 · 只读(该 source 未提供 demo surface)"),
      );
    }
    if (lastError !== undefined) {
      panel.appendChild(el("div", { "data-testid": "surface-demo-error", style: "font-size:12px;color:#c00" }, lastError));
    }
    if (snap !== undefined && snap.log.length > 0) {
      const list = el("ul", { "data-testid": "surface-demo-log", style: "font-size:12px;opacity:.8;margin:0" });
      for (const line of snap.log) list.appendChild(el("li", {}, line));
      panel.appendChild(list);
    }
    root.appendChild(panel);
  };

  conn.surface.subscribe(STATE_KEY, (value) => {
    snap = readSnapshot(value);
    render();
  });
  render();
}

void main();

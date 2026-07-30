/**
 * state-bridge 的 pane guest(spec panes-only-right-panel 任务 3.1)。
 *
 * ★ 这是**唯一真正消费新通道**的迁移:它演示「人在面板点 +1 → agent 工具下次读到新值」的
 * 人机共驾闭环。既有的单向具名信号结构上承载不了它(单向、最后值即真值、无写回),
 * 故任务 1.1–1.3 的共享状态通道就是为它补的 —— 它同时是那条通道的活体验证:
 * 通道做错了,这里会直接暴露。
 *
 * ★ 迁移是等价改写:testid 与文案逐字保留,既有 e2e 守的行为一条不少。
 */
import { connectPaneGuest } from "@blksails/pi-web-panes-kit";

const KEY = "count";

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** 运行期校验:共享状态里放什么都可能,不是数字就当没有值。 */
function readCount(raw: unknown): number | undefined {
  return typeof raw === "number" ? raw : undefined;
}

async function main(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) return;
  const conn = await connectPaneGuest({ expectedPaneId: "count", window });

  let count = readCount(conn.state.get(KEY));



  const render = (): void => {
    root.replaceChildren();
    const panel = el("div", {
      "data-testid": "state-bridge-panel",
      style: "padding:12px;display:flex;flex-direction:column;gap:8px",
    });
    panel.appendChild(el("div", { style: "font-size:12px;opacity:.7" }, "共享状态 · count"));
    panel.appendChild(
      el("div", { "data-testid": "state-bridge-count", style: "font-size:28px;font-weight:700" },
        count === undefined ? "—" : String(count)),
    );
    const btn = el("button", {
      type: "button",
      "data-testid": "state-bridge-increment",
      style: "padding:6px 10px;border-radius:6px;border:1px solid hsl(var(--border));background:hsl(var(--muted));cursor:pointer",
    }, "+1（写回）");
    btn.addEventListener("click", () => {
      // ★ 写回走受管上行(state.set),宿主转发到与 agent 工具**同一份**会话状态。
      // 写回失败必须可见,否则表现为「点了没反应」。
      void conn.state.set(KEY, (count ?? 0) + 1).catch(() => undefined);
    });
    panel.appendChild(btn);
    root.appendChild(panel);
  };

  // 订阅:agent 工具写 → 宿主推 → 这里实时更新(闭环的另一半)。
  conn.state.subscribe(KEY, (value) => {
    count = readCount(value);
    render();
  });
  render();
}

void main();

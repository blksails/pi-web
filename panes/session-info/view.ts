/**
 * `host:session-info` 的纯视图层(spec host-builtin-panes,任务 3.1)。
 *
 * 与 `main.tsx` 的分工:本文件**零副作用** —— 只有「校验载荷」与「据载荷渲染进给定容器」两件
 * 纯粹的事,故可在 jsdom 下直接单测。`main.tsx` 只负责建连、订阅与生命周期,那部分的行为由
 * 真实浏览器 e2e 覆盖。
 *
 * 拆开的理由很具体:`main.tsx` 顶层有 `void main()`,import 它就会尝试建连 —— 测试无从引用。
 * 而「缺字段时显示空态而不是崩溃」恰恰是本 pane 最该被测的行为(通道返回值的泛型是断言不是
 * 校验,既有教训是错误体被当正常结果解构导致整个 pane 被卸载)。
 */

/** 与宿主侧 `lib/app/builtin-panes/session-signal.ts` 约定的信号名。 */
export const SESSION_SIGNAL = "host:session";

export interface SessionFacts {
  readonly sessionId: string;
  readonly agentSource: string;
  readonly cwd: string;
}

const FACT_KEYS = ["sessionId", "agentSource", "cwd"] as const;

const LABELS: ReadonlyArray<readonly [keyof SessionFacts, string]> = [
  ["sessionId", "会话标识"],
  ["agentSource", "agent 源"],
  ["cwd", "工作目录"],
];

/**
 * 运行期校验信号载荷。
 *
 * 刻意**逐字段**校验而非整体断言:宿主某次改动只漏推一个字段时,应显示其余字段 + 该字段的
 * 缺失态,而不是整块降级为空 —— 后者会把排查从「哪个字段没推」退化成「什么都没有」。
 *
 * 非对象、null、字段类型不符、空字符串一律按「该字段缺失」处理,绝不抛错。
 */
export function readFacts(raw: unknown): Partial<SessionFacts> {
  if (typeof raw !== "object" || raw === null) return {};
  const obj = raw as Record<string, unknown>;
  const facts: Record<string, string> = {};
  for (const key of FACT_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.length > 0) facts[key] = value;
  }
  return facts as Partial<SessionFacts>;
}

/**
 * 把会话事实渲染进容器。
 *
 * 全部字段都缺 → 空态提示(含「宿主未推送」的指向,便于排查);部分缺 → 该行显示占位符。
 * 任何情形下都产出可见内容,不留白屏 —— 白屏与「pane 没装上」在观察上无法区分。
 */
export function render(
  root: HTMLElement,
  facts: Partial<SessionFacts>,
  paneMeta: string,
): void {
  const knownCount = LABELS.filter(([key]) => facts[key] !== undefined).length;
  root.replaceChildren();

  const pane = document.createElement("div");
  pane.className = "pane";
  const body = document.createElement("div");
  body.className = "pane-body";
  body.setAttribute("data-pi-session-info", "");

  if (knownCount === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.setAttribute("data-pi-session-info-empty", "");
    empty.textContent = "尚未收到会话信息。若持续为空,说明宿主未推送 host:session 信号。";
    body.append(empty);
  } else {
    const list = document.createElement("dl");
    list.className = "kv";
    for (const [key, label] of LABELS) {
      const value = facts[key];
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.setAttribute("data-pi-session-field", key);
      if (value === undefined) {
        // 单字段缺失单独可见 —— 便于定位「宿主漏推了哪一个」。
        dd.className = "muted";
        dd.textContent = "—";
      } else {
        dd.textContent = value;
      }
      list.append(dt, dd);
    }
    body.append(list);
  }

  const meta = document.createElement("p");
  meta.className = "muted mono";
  meta.setAttribute("data-pi-session-info-meta", "");
  meta.textContent = paneMeta;
  body.append(meta);

  pane.append(body);
  root.append(pane);
}

/**
 * PiInteraction — 扩展 UI 交互内联卡片(select / confirm / input / editor 四类 + 回传 + 留痕)。
 *
 * 取代既有模态 PiPermissionDialog:不再以 Radix Dialog 浮层呈现,而是作为对话消息流末尾的
 * 内联卡片渲染。仅队首待处理请求(`extensionUI.current`,FIFO)为可应答(active);应答经
 * `respond(requestId, response)` 回传(携带匹配 id),成功后该项以**只读终态留痕**保留在 active
 * 之上(组件本地 state,生命周期 = 组件 mount 期,刷新/重挂载即清空,不写持久层或消息历史)。
 * 失败保留 active 卡 + 显示错误 + 允许重试;提交进行中禁用动作控件。
 *
 * 可达性:容器 role="group" + 可访问名;新 active 出现时经 sr-only aria-live 区播报、滚动可见、
 * 聚焦首个可操作控件;非模态、不锁定焦点(用户可离开继续输入)。
 *
 * 仅处理交互类(select/confirm/input/editor);通知/状态/widget 等 ambient method 不在此渲染。
 * 主题经 shadcn CSS 变量(cn),无硬编码颜色。
 */
import * as React from "react";
import { Check, X, Ban } from "lucide-react";
import type { UseExtensionUIResult } from "@pi-web/react";
import type {
  RpcExtensionUIRequest,
  UiResponseRequest,
} from "@pi-web/protocol";
import { Card } from "../ui/card.js";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

export interface PiInteractionProps {
  readonly extensionUI: UseExtensionUIResult;
  readonly className?: string;
}

/** 交互类请求(四类 method);ambient method 不在内联交互呈现。 */
type InteractiveRequest = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

/** 应答结果(判别式联合),驱动终态留痕文案。 */
type InteractionOutcome =
  | { readonly kind: "confirm"; readonly confirmed: boolean }
  | {
      readonly kind: "value";
      readonly method: "select" | "input" | "editor";
      readonly value: string;
    }
  | { readonly kind: "cancelled" };

/** 已应答留痕项(本地、按应答先后保留)。 */
interface ResolvedInteraction {
  readonly id: string;
  readonly request: InteractiveRequest;
  readonly outcome: InteractionOutcome;
}

function isInteractive(
  req: RpcExtensionUIRequest | undefined,
): req is InteractiveRequest {
  if (req === undefined) return false;
  return (
    req.method === "select" ||
    req.method === "confirm" ||
    req.method === "input" ||
    req.method === "editor"
  );
}

export function PiInteraction({
  extensionUI,
  className,
}: PiInteractionProps): React.JSX.Element | null {
  const [resolved, setResolved] = React.useState<ResolvedInteraction[]>([]);
  const [localError, setLocalError] = React.useState<string | undefined>(
    undefined,
  );

  const current = extensionUI.current;
  // active = 队首交互类请求,且尚未在本地留痕中(双保险:mock/竞态下出队前不重复渲染)。
  const active: InteractiveRequest | undefined =
    isInteractive(current) && !resolved.some((r) => r.id === current.id)
      ? current
      : undefined;

  const hookError =
    extensionUI.error === undefined || extensionUI.error === null
      ? undefined
      : extensionUI.error instanceof Error
        ? extensionUI.error.message
        : String(extensionUI.error);
  const errorMsg = localError ?? hookError;

  const submit = React.useCallback(
    (
      request: InteractiveRequest,
      response: UiResponseRequest,
      outcome: InteractionOutcome,
    ): void => {
      setLocalError(undefined);
      void extensionUI
        .respond(request.id, response)
        .then(() => {
          // 成功才记入留痕(失败保留 active 允许重试)。
          setResolved((prev) => [...prev, { id: request.id, request, outcome }]);
        })
        .catch((err: unknown) => {
          setLocalError(err instanceof Error ? err.message : String(err));
        });
    },
    [extensionUI],
  );

  const onConfirm = (request: InteractiveRequest, confirmed: boolean): void => {
    submit(
      request,
      { type: "extension_ui_response", id: request.id, confirmed },
      { kind: "confirm", confirmed },
    );
  };

  const onValue = (
    request: InteractiveRequest,
    method: "select" | "input" | "editor",
    value: string,
  ): void => {
    submit(
      request,
      { type: "extension_ui_response", id: request.id, value },
      { kind: "value", method, value },
    );
  };

  const onCancel = (request: InteractiveRequest): void => {
    submit(
      request,
      { type: "extension_ui_response", id: request.id, cancelled: true },
      { kind: "cancelled" },
    );
  };

  // 无留痕且无 active → 不渲染(降级 / 空态)。
  if (resolved.length === 0 && active === undefined) return null;

  return (
    <div
      data-pi-interaction
      role="group"
      aria-label="扩展交互"
      className={cn("flex flex-col gap-2", className)}
    >
      {/* sr-only 实时播报区:active 标题变化时以非打断优先级播报新交互请求(Req 5.1)。 */}
      <div className="sr-only" aria-live="polite" data-pi-interaction-live>
        {active !== undefined ? `交互请求：${active.title}` : ""}
      </div>

      {resolved.map((item) => (
        <ResolvedCard key={item.id} item={item} />
      ))}

      {active !== undefined ? (
        <ActiveCard
          key={active.id}
          request={active}
          pending={extensionUI.pending}
          error={errorMsg}
          onConfirm={(confirmed) => onConfirm(active, confirmed)}
          onValue={(method, value) => onValue(active, method, value)}
          onCancel={() => onCancel(active)}
        />
      ) : null}
    </div>
  );
}

/** 已应答终态留痕(只读)。 */
function ResolvedCard({
  item,
}: {
  readonly item: ResolvedInteraction;
}): React.JSX.Element {
  const { request, outcome } = item;
  const { label, icon } = resolvedLabel(outcome);
  return (
    <Card
      className="flex flex-col gap-1 px-3 py-2 text-sm opacity-80"
      data-pi-interaction-resolved
      data-pi-interaction-outcome={outcome.kind}
      data-pi-interaction-method={request.method}
    >
      <div className="font-medium text-[hsl(var(--foreground))]">
        {request.title}
      </div>
      <div className="flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]">
        {icon}
        <span>{label}</span>
      </div>
      {outcome.kind === "value" && outcome.method === "editor" ? (
        <pre className="mt-1 line-clamp-3 overflow-hidden whitespace-pre-wrap break-words rounded-[var(--radius)] bg-[hsl(var(--muted))] p-2 font-mono text-xs text-[hsl(var(--muted-foreground))]">
          {outcome.value}
        </pre>
      ) : null}
    </Card>
  );
}

/** 终态文案 + 图标(Req 3.2–3.6)。 */
function resolvedLabel(outcome: InteractionOutcome): {
  label: string;
  icon: React.JSX.Element;
} {
  if (outcome.kind === "confirm") {
    return outcome.confirmed
      ? { label: "已批准", icon: <Check className="h-4 w-4" aria-hidden="true" /> }
      : { label: "已拒绝", icon: <X className="h-4 w-4" aria-hidden="true" /> };
  }
  if (outcome.kind === "cancelled") {
    return { label: "已取消", icon: <Ban className="h-4 w-4" aria-hidden="true" /> };
  }
  // value
  if (outcome.method === "select") {
    return {
      label: `已选择：${outcome.value}`,
      icon: <Check className="h-4 w-4" aria-hidden="true" />,
    };
  }
  if (outcome.method === "input") {
    return {
      label: `已提交：${outcome.value}`,
      icon: <Check className="h-4 w-4" aria-hidden="true" />,
    };
  }
  // editor:正文折叠展示,标签仅示已提交
  return { label: "已提交", icon: <Check className="h-4 w-4" aria-hidden="true" /> };
}

/** 可应答 active 卡:按 method 渲染表单 + 提交/取消;挂载时聚焦首动作并滚动可见。 */
function ActiveCard({
  request,
  pending,
  error,
  onConfirm,
  onValue,
  onCancel,
}: {
  readonly request: InteractiveRequest;
  readonly pending: boolean;
  readonly error: string | undefined;
  readonly onConfirm: (confirmed: boolean) => void;
  readonly onValue: (method: "select" | "input" | "editor", value: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const [text, setText] = React.useState<string>(
    request.method === "editor" ? (request.prefill ?? "") : "",
  );
  const [selected, setSelected] = React.useState<string | undefined>(
    request.method === "select" ? request.options[0] : undefined,
  );
  const cardRef = React.useRef<HTMLDivElement>(null);

  // 新 active 出现(key 变化重新挂载)时:聚焦首个可操作控件 + 滚动至可见(Req 5.2/5.3)。
  // 不做 focus trap;用户可 tab 离开继续输入(Req 5.4)。
  React.useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    const focusable = el.querySelector<HTMLElement>(
      "button, input, textarea, [tabindex]",
    );
    focusable?.focus();
    if (typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, []);

  const title = request.title;

  return (
    <Card
      ref={cardRef}
      className="flex flex-col gap-3 px-4 py-3"
      data-pi-interaction-active
      data-pi-interaction-method={request.method}
    >
      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium text-[hsl(var(--foreground))]">
          {title}
        </div>
        {request.method === "confirm" ? (
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {request.message}
          </p>
        ) : null}
      </div>

      {request.method === "select" ? (
        <div role="radiogroup" aria-label={title} className="flex flex-col gap-1">
          {request.options.map((opt) => (
            <label
              key={opt}
              className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))]"
            >
              <input
                type="radio"
                name={`pi-select-${request.id}`}
                value={opt}
                checked={selected === opt}
                onChange={() => setSelected(opt)}
                disabled={pending}
                data-pi-select-option={opt}
              />
              {opt}
            </label>
          ))}
        </div>
      ) : null}

      {request.method === "input" ? (
        <input
          type="text"
          aria-label={title}
          placeholder={request.placeholder ?? ""}
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
          className="h-9 w-full rounded-[var(--radius)] border border-[hsl(var(--input))] bg-[hsl(var(--background))] px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-pi-input
        />
      ) : null}

      {request.method === "editor" ? (
        <textarea
          aria-label={title}
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          disabled={pending}
          className="w-full rounded-[var(--radius)] border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
          data-pi-editor
        />
      ) : null}

      {error !== undefined ? (
        <p
          role="alert"
          className="text-sm text-[hsl(var(--destructive))]"
          data-pi-interaction-error
        >
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        {request.method === "confirm" ? (
          <>
            <Button
              onClick={() => onConfirm(true)}
              disabled={pending}
              data-pi-confirm-ok
            >
              批准
            </Button>
            <Button
              variant="outline"
              onClick={() => onConfirm(false)}
              disabled={pending}
              data-pi-confirm-cancel
            >
              拒绝
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={() => {
                const value =
                  request.method === "select" ? (selected ?? "") : text;
                const method =
                  request.method === "select"
                    ? "select"
                    : request.method === "input"
                      ? "input"
                      : "editor";
                onValue(method, value);
              }}
              disabled={pending}
              data-pi-interaction-submit
            >
              提交
            </Button>
            <Button
              variant="outline"
              onClick={() => onCancel()}
              disabled={pending}
              data-pi-interaction-cancel
            >
              取消
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

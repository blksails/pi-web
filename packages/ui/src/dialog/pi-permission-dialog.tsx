/**
 * PiPermissionDialog — 扩展 UI 弹窗(select / confirm / input / editor 四类 + 回传)。
 *
 * 渲染 `extensionUI.current` 首项;按 `method` 渲染对应控件;提交经
 * `respond(requestId, uiResponse)` 回传与请求匹配的响应。失败保留弹窗 + 显示错误 + 允许重试。
 * 焦点捕获 / Esc 关闭 / 关闭后焦点还原 / aria 对话框语义由 Radix Dialog 提供。
 *
 * 仅处理交互类(select/confirm/input/editor);通知/状态/widget 等非交互 method 不弹窗。
 */
import * as React from "react";
import type { UseExtensionUIResult } from "@pi-web/react";
import type {
  RpcExtensionUIRequest,
  UiResponseRequest,
} from "@pi-web/protocol";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog.js";
import { Button } from "../ui/button.js";
import { cn } from "../lib/cn.js";

export interface PiPermissionDialogProps {
  readonly extensionUI: UseExtensionUIResult;
  readonly className?: string;
}

type InteractiveRequest = Extract<
  RpcExtensionUIRequest,
  { method: "select" | "confirm" | "input" | "editor" }
>;

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

export function PiPermissionDialog({
  extensionUI,
  className,
}: PiPermissionDialogProps): React.JSX.Element | null {
  const current = extensionUI.current;

  if (!isInteractive(current)) return null;

  return (
    <PermissionDialogInner
      key={current.id}
      request={current}
      extensionUI={extensionUI}
      className={className}
    />
  );
}

function PermissionDialogInner({
  request,
  extensionUI,
  className,
}: {
  readonly request: InteractiveRequest;
  readonly extensionUI: UseExtensionUIResult;
  readonly className?: string;
}): React.JSX.Element {
  const [text, setText] = React.useState<string>(
    request.method === "editor" ? (request.prefill ?? "") : "",
  );
  const [selected, setSelected] = React.useState<string | undefined>(
    request.method === "select" ? request.options[0] : undefined,
  );
  const [localError, setLocalError] = React.useState<string | undefined>(
    undefined,
  );

  const hookError =
    extensionUI.error === undefined || extensionUI.error === null
      ? undefined
      : extensionUI.error instanceof Error
        ? extensionUI.error.message
        : String(extensionUI.error);
  const errorMsg = localError ?? hookError;

  const submit = (response: UiResponseRequest): void => {
    setLocalError(undefined);
    void extensionUI.respond(request.id, response).catch((err: unknown) => {
      setLocalError(err instanceof Error ? err.message : String(err));
    });
  };

  const cancel = (): void => {
    submit({
      type: "extension_ui_response",
      id: request.id,
      cancelled: true,
    });
  };

  const title =
    "title" in request && request.title !== undefined
      ? request.title
      : "Permission";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent
        className={cn(className)}
        data-pi-permission-dialog
        data-pi-permission-method={request.method}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {request.method === "confirm" ? (
            <DialogDescription>{request.message}</DialogDescription>
          ) : null}
        </DialogHeader>

        {request.method === "select" ? (
          <div
            role="radiogroup"
            aria-label={title}
            className="flex flex-col gap-1"
          >
            {request.options.map((opt) => (
              <label
                key={opt}
                className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-[hsl(var(--accent))]"
              >
                <input
                  type="radio"
                  name="pi-select"
                  value={opt}
                  checked={selected === opt}
                  onChange={() => setSelected(opt)}
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
            className="w-full rounded-[var(--radius)] border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-3 font-mono text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-pi-editor
          />
        ) : null}

        {errorMsg !== undefined ? (
          <p
            role="alert"
            className="text-sm text-[hsl(var(--destructive))]"
            data-pi-permission-error
          >
            {errorMsg}
          </p>
        ) : null}

        <DialogFooter>
          {request.method === "confirm" ? (
            <>
              <Button
                variant="outline"
                onClick={() =>
                  submit({
                    type: "extension_ui_response",
                    id: request.id,
                    confirmed: false,
                  })
                }
                disabled={extensionUI.pending}
                data-pi-confirm-cancel
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  submit({
                    type: "extension_ui_response",
                    id: request.id,
                    confirmed: true,
                  })
                }
                disabled={extensionUI.pending}
                data-pi-confirm-ok
              >
                Confirm
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={cancel}
                disabled={extensionUI.pending}
                data-pi-cancel
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const value =
                    request.method === "select"
                      ? (selected ?? "")
                      : text;
                  submit({
                    type: "extension_ui_response",
                    id: request.id,
                    value,
                  });
                }}
                disabled={extensionUI.pending}
                data-pi-submit
              >
                Submit
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

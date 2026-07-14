/**
 * useCatalogMaterialize — accept 异步换写状态机(spec agent-attachment-catalog,任务 5.2;
 * Req 3.2, 3.4)。
 *
 * `PiCompletionPopover` 的 `select(item)` 已同步把 `@catalog:<entryId>` token 插入输入框
 * (`accept()` + `onChange`,completion-provider-framework 既有行为不变)。本 hook 挂在
 * `onAccept` 之后:对 `kind === "catalog"` 的候选,发起后台物化调用;完成时按**精确原 token
 * 文本**在当前输入框内容里定位:
 *  - 成功:命中 → 原位换写为标准 `@attachment:<attId>` token(与普通附件同等待遇,携带尾随
 *    空格一并保留,不破坏用户后续输入),并回调 `onMaterialized` 供上层注册预览缩略图
 *    (attachment-mention-preview 同构)。
 *  - 成功但命中不到(原 token 已被用户编辑/删除)→ 放弃换写(用户继续输入或提交期由
 *    catalog provider 的 resolve 兜底物化,幂等保证不重复落库)。
 *  - 失败:命中 → 撤 token(连同紧随的一个空格一并移除);无论是否命中都回调 `onError`
 *    供上层展示 toast。
 *
 * 完成时机取值用 `getValue()`(而非闭包捕获的旧 value)——异步完成时用户可能已继续输入,
 * 必须读最新文本才能正确定位/放弃。
 */
import * as React from "react";
import type { Attachment, CompletionItem } from "@blksails/pi-web-protocol";

/** 仅依赖物化端点一个方法的最小客户端面(结构兼容 @blksails/pi-web-react 的 PiClient)。 */
export interface CatalogMaterializeClient {
  materializeCatalogEntry(
    sessionId: string,
    entryId: string,
  ): Promise<{ attachmentId: string; attachment: Attachment; displayUrl: string }>;
}

export interface UseCatalogMaterializeArgs {
  readonly client?: CatalogMaterializeClient;
  readonly sessionId?: string;
  /** 取当前输入框最新文本(不用闭包捕获的旧值)。 */
  readonly getValue: () => string;
  readonly onChange: (next: string) => void;
  /** 换写成功后回调:供上层注册预览(attachment-mention-preview 同构)。 */
  readonly onMaterialized?: (
    attachmentId: string,
    attachment: Attachment,
    displayUrl: string,
  ) => void;
  /** 物化失败时回调:供上层展示 toast(消息已本地化由上层决定)。 */
  readonly onError?: (message: string) => void;
}

export interface UseCatalogMaterializeResult {
  /**
   * `PiCompletionPopover` 的 `onAccept` 回调透传入口:非 `kind==="catalog"` 候选安全忽略
   * (no-op)。
   */
  materialize(item: CompletionItem): void;
}

/** 从 `s` 中找到并移除 `token`(及紧随其后的一个空格,若存在);未命中返回 `undefined`。 */
function tryReplaceToken(
  s: string,
  token: string,
  replacement: string,
): string | undefined {
  const idx = s.indexOf(token);
  if (idx === -1) return undefined;
  return s.slice(0, idx) + replacement + s.slice(idx + token.length);
}

function tryRemoveToken(s: string, token: string): string | undefined {
  const idx = s.indexOf(token);
  if (idx === -1) return undefined;
  const hasTrailingSpace = s[idx + token.length] === " ";
  const removeLen = token.length + (hasTrailingSpace ? 1 : 0);
  return s.slice(0, idx) + s.slice(idx + removeLen);
}

export function useCatalogMaterialize(
  args: UseCatalogMaterializeArgs,
): UseCatalogMaterializeResult {
  const { client, sessionId, getValue, onChange, onMaterialized, onError } = args;

  const materialize = React.useCallback(
    (item: CompletionItem): void => {
      if (item.kind !== "catalog") return; // 非目录候选:no-op
      if (client === undefined || sessionId === undefined) return;
      const token = item.insertText ?? `@catalog:${item.id}`;

      void client
        .materializeCatalogEntry(sessionId, item.id)
        .then((res) => {
          const current = getValue();
          const next = tryReplaceToken(
            current,
            token,
            `@attachment:${res.attachmentId}`,
          );
          if (next === undefined) return; // 原 token 已被编辑/删除:放弃换写(resolve 兜底仍在)
          onChange(next);
          onMaterialized?.(res.attachmentId, res.attachment, res.displayUrl);
        })
        .catch((err: unknown) => {
          const current = getValue();
          const next = tryRemoveToken(current, token);
          if (next !== undefined) onChange(next);
          onError?.(err instanceof Error ? err.message : String(err));
        });
    },
    [client, sessionId, getValue, onChange, onMaterialized, onError],
  );

  return { materialize };
}

/**
 * PiChatBasic — 最小拖入聊天组件(原 `PiChat`;富组件收敛为默认 `PiChat` 后改名)。
 *
 * 从 `usePiSession` 取 `transport` 喂 `useChat({ transport })` 驱动消息流;按 part 类型经
 * `PartRenderer` 分派渲染;经 PromptInput 提交追加用户消息;流式进行中指示 + 中止入口
 * (usePiControls.abort);内嵌内联交互卡 `<PiInteraction>`(useExtensionUI);可选内置控制面板;
 * 暴露 header/footer/sidebar/messageActions 插槽。本组件不实现任何 REST/SSE 传输逻辑。
 */
import * as React from "react";
import { useChat } from "@ai-sdk/react";
import { Loader2, Send, Square } from "lucide-react";
import type { UIMessage } from "ai";
import type {
  UsePiSessionResult,
  UsePiControlsResult,
  UseExtensionUIResult,
} from "@pi-web/react";
import { PartRenderer } from "./part-renderer.js";
import type { PiChatSlots } from "./slots.js";
import { PiInteraction } from "../elements/pi-interaction.js";
import { PiModelSelector } from "../controls/pi-model-selector.js";
import { PiThinkingLevel } from "../controls/pi-thinking-level.js";
import { PiSessionStats } from "../controls/pi-session-stats.js";
import { Button } from "../ui/button.js";
import type { RendererRegistry } from "../registry/renderer-registry.js";
import { cn } from "../lib/cn.js";

export interface PiChatBasicProps {
  /** 来自 usePiSession;提供绑定的 transport 与连接态。 */
  readonly session: UsePiSessionResult;
  /** 来自 usePiControls;驱动 abort/model/thinking/stats。 */
  readonly controls?: UsePiControlsResult;
  /** 来自 useExtensionUI;驱动权限弹窗。 */
  readonly extensionUI?: UseExtensionUIResult;
  readonly slots?: PiChatSlots;
  /** 是否展示内置控制面板(模型/思考/stats),默认 true。 */
  readonly showControls?: boolean;
  /** 可注入隔离的渲染器注册表(默认用模块级单例)。 */
  readonly registry?: RendererRegistry;
  readonly className?: string;
}

export function PiChatBasic({
  session,
  controls,
  extensionUI,
  slots,
  showControls = true,
  registry,
  className,
}: PiChatBasicProps): React.JSX.Element {
  const transport = session.transport;

  const chat = useChat(
    transport === undefined ? {} : { transport },
  );
  const { messages, sendMessage, status } = chat;
  const [input, setInput] = React.useState<string>("");

  const isStreaming = status === "streaming" || status === "submitted";

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    const text = input.trim();
    if (text.length === 0 || transport === undefined) return;
    void sendMessage({ text });
    setInput("");
  };

  const onAbort = (): void => {
    // 优先经 pi 控制层中止;同时停止本地流。
    if (controls !== undefined) void controls.abort().catch(() => undefined);
    chat.stop();
  };

  return (
    <div
      className={cn(
        "flex h-full w-full gap-3 text-[hsl(var(--foreground))]",
        className,
      )}
      data-pi-chat
    >
      {slots?.sidebar !== undefined ? (
        <aside className="shrink-0" data-pi-chat-sidebar>
          {slots.sidebar}
        </aside>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {slots?.header !== undefined ? (
          <header data-pi-chat-header>{slots.header}</header>
        ) : null}

        {showControls && controls !== undefined ? (
          <div
            className="flex flex-wrap items-end gap-2 border-b border-[hsl(var(--border))] pb-2"
            data-pi-chat-controls
          >
            <PiModelSelector controls={controls} />
            <PiThinkingLevel controls={controls} />
            <div className="ml-auto">
              <PiSessionStats controls={controls} />
            </div>
          </div>
        ) : null}

        <div
          className="flex-1 space-y-4 overflow-y-auto py-3"
          data-pi-chat-messages
          role="log"
          aria-live="polite"
        >
          {messages.map((message: UIMessage) => (
            <div
              key={message.id}
              data-pi-message
              data-pi-message-role={message.role}
              className="space-y-2"
            >
              {message.parts.map((part, i) => (
                <PartRenderer
                  key={`${message.id}-${i}`}
                  part={part}
                  message={message}
                  {...(registry !== undefined ? { registry } : {})}
                />
              ))}
              {slots?.messageActions !== undefined ? (
                <div data-pi-message-actions>
                  {slots.messageActions(message)}
                </div>
              ) : null}
            </div>
          ))}
          {isStreaming ? (
            <div
              className="flex items-center gap-2 text-sm text-[hsl(var(--muted-foreground))]"
              data-pi-streaming
              role="status"
            >
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Generating…
            </div>
          ) : null}
          {/* 扩展 UI 交互内联卡(取代模态弹窗):渲染于消息流末尾,随流滚动。 */}
          {extensionUI !== undefined ? (
            <PiInteraction extensionUI={extensionUI} />
          ) : null}
        </div>

        <form
          onSubmit={onSubmit}
          className="flex items-end gap-2 border-t border-[hsl(var(--border))] pt-2"
          data-pi-prompt-input
        >
          <textarea
            aria-label="Message"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                onSubmit(e);
              }
            }}
            rows={2}
            placeholder="Type a message…"
            className="min-w-0 flex-1 resize-none rounded-[var(--radius)] border border-[hsl(var(--input))] bg-[hsl(var(--background))] p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
            data-pi-input-textarea
          />
          {isStreaming ? (
            <Button
              type="button"
              variant="destructive"
              size="icon"
              onClick={onAbort}
              aria-label="Stop"
              data-pi-abort
            >
              <Square className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              type="submit"
              size="icon"
              aria-label="Send"
              disabled={transport === undefined}
              data-pi-send
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </form>

        {slots?.footer !== undefined ? (
          <footer data-pi-chat-footer>{slots.footer}</footer>
        ) : null}
      </div>
    </div>
  );
}

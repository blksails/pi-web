"use client";

import * as React from "react";
import {
  PiProvider,
  usePiSession,
  usePiControls,
  useExtensionUI,
  type UsePiSessionResult,
} from "@pi-web/react";
import { PiChat, type ExtensionCommandPolicy } from "@pi-web/ui";
import type { CreateSessionRequest } from "@pi-web/protocol";
import { AgentSourcePicker } from "./agent-source-picker.js";
import { ThemeToggleButton } from "@/app/theme-controls.js";
import { resolveExtensionForSource } from "@/lib/app/webext-registry.js";

/**
 * ChatApp — the client-side assembly: pick source → create session → render
 * the rich chat UI <PiChat> (default rich component; formerly <PiChatPro>) with
 * controls + permission dialog.
 *
 * Until a session is created it renders <AgentSourcePicker>. On submit it builds
 * a CreateSessionRequest (source + default cwd/model) and drives the connection
 * via @pi-web/react hooks pointed at this site's `/api/sessions`. Controls and
 * the permission dialog ride hook side-channels — they never enter the message
 * stream (Req 6.4). Both custom-agent and general-CLI modes reuse this same
 * page (Req 9.3).
 *
 * URL resume: when `resumeId` is provided (via the `/session/[id]` route) the
 * app skips the picker and resumes that session, loading its history. On any
 * new session the browser address is synced to `/session/:id` (history
 * replaceState — no full navigation), so the URL always reflects the session.
 */
export interface ChatAppProps {
  readonly defaultSource: string | undefined;
  /** Optional model override; when undefined, the agent uses ~/.pi/agent settings.json. */
  readonly defaultModel: string | undefined;
  readonly defaultCwd: string;
  /** When set, resume this existing session (cold-resume + continue) instead of picking a source. */
  readonly resumeId?: string;
}

interface ActiveSession {
  readonly create: CreateSessionRequest;
  /** Present only when this session is a resume of an existing one. */
  readonly resumeId?: string;
}

/** Build the create request from props + a resolved source. */
function buildCreate(props: ChatAppProps, source: string): CreateSessionRequest {
  return {
    source,
    cwd: props.defaultCwd,
    // Only force a model when explicitly configured; otherwise the agent
    // process honors ~/.pi/agent/settings.json defaultModel/defaultProvider.
    ...(props.defaultModel !== undefined && props.defaultModel.length > 0
      ? { model: props.defaultModel }
      : {}),
  };
}

/**
 * 扩展(source==="extension")命令在命令补全里的可见策略。
 *
 * 默认隐藏所有扩展命令:它们在 web 端会让该轮永久卡 pending(扩展命令本地执行后提前
 * 返回、不发 agent_end,详见 PiCommandPalette 文件头)。可经环境变量覆盖(client 端
 * 读取 NEXT_PUBLIC_*,构建时内联):
 *   NEXT_PUBLIC_PI_EXTENSION_COMMANDS=all        → 放行所有扩展命令(谨慎,可能卡死)
 *   NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST=foo,bar   → 仅按名放行(逗号分隔),其余仍隐藏
 *
 * 模块级常量:引用稳定,避免每次渲染产生新对象使下游 useMemo 失效。
 */
const EXTENSION_COMMAND_POLICY: ExtensionCommandPolicy = {
  enabled: process.env.NEXT_PUBLIC_PI_EXTENSION_COMMANDS === "all",
  allowlist: (process.env.NEXT_PUBLIC_PI_EXTENSION_ALLOWLIST ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0),
};

/** 声明式 layout preset 白名单收窄(R27);返回类型绑定到 PiChat 的 layout prop。 */
const LAYOUT_PRESETS: readonly string[] = ["centered", "wide", "full", "split"];
type LayoutPresetValue = NonNullable<
  React.ComponentProps<typeof PiChat>["layout"]
>;
function narrowLayoutPreset(
  v: string | undefined,
): LayoutPresetValue | undefined {
  return v !== undefined && LAYOUT_PRESETS.includes(v)
    ? (v as LayoutPresetValue)
    : undefined;
}

export function ChatApp(props: ChatAppProps): React.JSX.Element {
  // Resume mode: enter SessionView immediately (skip the picker).
  const [session, setSession] = React.useState<ActiveSession | undefined>(
    props.resumeId !== undefined
      ? {
          create: buildCreate(props, props.defaultSource ?? "."),
          resumeId: props.resumeId,
        }
      : undefined,
  );

  const onSubmit = (source: string): void => {
    const resolved = source.length > 0 ? source : (props.defaultSource ?? ".");
    // New session: no resumeId.
    setSession({ create: buildCreate(props, resolved) });
  };

  const onReset = (): void => {
    setSession(undefined);
    // Drop back to the picker URL so a refresh does not re-resume.
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", "/");
    }
  };

  return (
    <PiProvider baseUrl="/api">
      {session === undefined ? (
        <AgentSourcePicker
          onSubmit={onSubmit}
          defaultSource={props.defaultSource}
        />
      ) : (
        <SessionView
          create={session.create}
          {...(session.resumeId !== undefined
            ? { resumeId: session.resumeId }
            : {})}
          onReset={onReset}
        />
      )}
    </PiProvider>
  );
}

function SessionView({
  create,
  resumeId,
  onReset,
}: {
  readonly create: CreateSessionRequest;
  readonly resumeId?: string;
  readonly onReset: () => void;
}): React.JSX.Element {
  const session: UsePiSessionResult = usePiSession({
    create,
    ...(resumeId !== undefined ? { resumeId } : {}),
    // Sync the browser address to /session/:id once the id is known (new or
    // resumed). No full navigation — keeps the live session intact.
    onSessionId: (id) => {
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/session/${id}`);
      }
    },
  });

  const controls = usePiControls({
    sessionId: session.sessionId,
    connection: session.connection,
  });

  const extensionUI = useExtensionUI({
    sessionId: session.sessionId,
    connection: session.connection,
  });

  // 构建期集成:按 agent source 解析其 UI 扩展(.pi/web),传给 <PiChat>(Tier1/2)。
  const extension = React.useMemo(
    () => resolveExtensionForSource(create.source),
    [create.source],
  );

  // Session creation failed → recognizable error + re-pick (Req 4.5).
  if (session.error !== undefined && session.status === "closed") {
    return (
      <div
        className="flex h-full w-full flex-col items-center justify-center gap-4 p-6"
        data-session-error
      >
        <p
          role="alert"
          className="rounded-md border border-[hsl(var(--destructive))] bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
        >
          Failed to create session: {session.error.message}
        </p>
        <button
          type="button"
          onClick={onReset}
          data-session-retry
          className="rounded-md border border-[hsl(var(--border))] px-4 py-2 text-sm font-medium"
        >
          Pick another source
        </button>
      </div>
    );
  }

  // Creating / connecting → progress indicator (Req 4.4).
  if (session.transport === undefined) {
    return (
      <div
        className="flex h-full w-full items-center justify-center p-6 text-sm text-[hsl(var(--muted-foreground))]"
        data-session-connecting
      >
        Connecting to session…
      </div>
    );
  }

  return (
    <div className="flex h-full w-full flex-col" data-session-active>
      <div className="flex items-center gap-3 border-b border-[hsl(var(--border))] px-4 py-2">
        <span className="text-sm font-medium">pi-web</span>
        <span
          className="text-xs text-[hsl(var(--muted-foreground))]"
          data-session-id
        >
          session: {session.sessionId}
        </span>
        <button
          type="button"
          onClick={onReset}
          className="ml-auto rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs"
        >
          New session
        </button>
        <a
          href="/settings"
          className="rounded-md border border-[hsl(var(--border))] px-3 py-1 text-xs"
          data-settings-link
        >
          设置
        </a>
        <ThemeToggleButton />
      </div>
      <div
        className="min-h-0 flex-1"
        {...(extension?.config?.theme !== undefined
          ? {
              "data-pi-ext-theme": "",
              // 声明式 theme token 注入会话根(命名空间隔离,不污染宿主全局)。
              style: extension.config.theme as React.CSSProperties,
            }
          : {})}
      >
        <PiChat
          session={session}
          controls={controls}
          extensionUI={extensionUI}
          extensionCommands={EXTENSION_COMMAND_POLICY}
          {...(extension !== undefined ? { extension } : {})}
          {...(narrowLayoutPreset(extension?.config?.layout) !== undefined
            ? { layout: narrowLayoutPreset(extension?.config?.layout) }
            : {})}
          {...(process.env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL !== undefined
            ? { extensionBaseUrl: process.env.NEXT_PUBLIC_PI_EXTENSION_BASE_URL }
            : {})}
        />
      </div>
    </div>
  );
}

"use client";

import * as React from "react";
import {
  PiProvider,
  usePiSession,
  usePiControls,
  useExtensionUI,
  type UsePiSessionResult,
} from "@pi-web/react";
import { PiChat } from "@pi-web/ui";
import type { CreateSessionRequest } from "@pi-web/protocol";
import { AgentSourcePicker } from "./agent-source-picker.js";

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
 */
export interface ChatAppProps {
  readonly defaultSource: string | undefined;
  /** Optional model override; when undefined, the agent uses ~/.pi/agent settings.json. */
  readonly defaultModel: string | undefined;
  readonly defaultCwd: string;
}

interface ActiveSession {
  readonly create: CreateSessionRequest;
}

export function ChatApp(props: ChatAppProps): React.JSX.Element {
  const [session, setSession] = React.useState<ActiveSession | undefined>(
    undefined,
  );

  const onSubmit = (source: string): void => {
    const resolved =
      source.length > 0 ? source : (props.defaultSource ?? ".");
    const create: CreateSessionRequest = {
      source: resolved,
      cwd: props.defaultCwd,
      // Only force a model when explicitly configured; otherwise the agent
      // process honors ~/.pi/agent/settings.json defaultModel/defaultProvider.
      ...(props.defaultModel !== undefined && props.defaultModel.length > 0
        ? { model: props.defaultModel }
        : {}),
    };
    setSession({ create });
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
          onReset={() => setSession(undefined)}
        />
      )}
    </PiProvider>
  );
}

function SessionView({
  create,
  onReset,
}: {
  readonly create: CreateSessionRequest;
  readonly onReset: () => void;
}): React.JSX.Element {
  const session: UsePiSessionResult = usePiSession({ create });

  const controls = usePiControls({
    sessionId: session.sessionId,
    connection: session.connection,
  });

  const extensionUI = useExtensionUI({
    sessionId: session.sessionId,
    connection: session.connection,
  });

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
      </div>
      <div className="min-h-0 flex-1 px-4 py-2">
        <PiChat
          session={session}
          controls={controls}
          extensionUI={extensionUI}
        />
      </div>
    </div>
  );
}

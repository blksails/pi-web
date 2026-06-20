import { ChatApp } from "@/components/chat-app";
import { loadConfig } from "@/lib/app/config";
import { makeResumeMetaLoader } from "@/lib/app/resume-meta";
import { lookupSessionSource } from "@/lib/app/session-source-map";

export const dynamic = "force-dynamic";

/**
 * Module-singleton resume-meta loader — same store backend the API handler uses
 * (`SESSION_STORE` env), so a cold `/session/:id` load can recover the session's
 * persisted agent source (= its agent cwd) without rebuilding the store handle
 * per request.
 */
const loadResumeMeta = makeResumeMetaLoader();

/**
 * Session page (server component) — `/session/:id`.
 *
 * Same non-secret config defaults as the home page, plus the route `id` handed
 * to <ChatApp> as `resumeId`: the client resumes that persisted session (loads
 * history + continues). If the session is unknown, session creation surfaces a
 * recognizable error and the picker is offered. Provider keys are NEVER read or
 * passed here.
 */
export default async function SessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;

  let defaultSource: string | undefined;
  let defaultModel: string | undefined;
  let defaultCwd = process.cwd();

  try {
    const config = loadConfig();
    defaultSource = config.defaultSource;
    defaultModel = config.defaultModel;
    defaultCwd = config.defaultCwd;
  } catch {
    defaultSource = process.env.PI_WEB_DEFAULT_SOURCE;
  }

  // Recover the resumed session's agent source so the webext registry can
  // re-resolve its UI extension on a cold load; without it `create.source`
  // falls back to "." and the extension surface (region slots, background, …)
  // silently disappears after a refresh. The URL stays clean (`/session/:id`,
  // no file path) — recovery is by id, not by query.
  //
  // Primary: the app-level sessionId → source map (recorded by the client at
  // creation) — present even for a brand-new, message-less session whose agent
  // header is not persisted yet. Fallback: the persisted session metadata
  // (header.cwd = resolved agent dir), covering sessions created before the map
  // existed. Read failures are non-fatal — the session still resumes by id.
  let resumeSource: string | undefined = await lookupSessionSource(id);
  if (resumeSource === undefined) {
    try {
      resumeSource = (await loadResumeMeta(id))?.source;
    } catch {
      resumeSource = undefined;
    }
  }

  return (
    <ChatApp
      defaultSource={defaultSource}
      defaultModel={defaultModel}
      defaultCwd={defaultCwd}
      resumeId={id}
      {...(resumeSource !== undefined ? { resumeSource } : {})}
    />
  );
}

import { ChatApp } from "@/components/chat-app";
import { loadConfig } from "@/lib/app/config";

export const dynamic = "force-dynamic";

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

  return (
    <ChatApp
      defaultSource={defaultSource}
      defaultModel={defaultModel}
      defaultCwd={defaultCwd}
      resumeId={id}
    />
  );
}

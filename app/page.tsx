import { ChatApp } from "@/components/chat-app";
import { loadConfig } from "@/lib/app/config";

export const dynamic = "force-dynamic";

/**
 * Home page (server component).
 *
 * Reads non-secret config defaults (default source / model / cwd) and hands
 * them to the client <ChatApp>. Provider keys are NEVER read here or passed to
 * the client. Config loading is guarded so a missing provider key (real mode)
 * still renders the source picker rather than crashing the page.
 */
export default function HomePage(): React.JSX.Element {
  let defaultSource: string | undefined;
  // Undefined → the agent process uses settings.json's defaultModel (~/.pi/agent),
  // so the UI honors your `pi` config instead of forcing a model here.
  let defaultModel: string | undefined;
  let defaultCwd = process.cwd();
  // CLI 已确定 source 时直接进会话、跳过选源页(PI_WEB_AUTOSTART)。
  let autoStart = false;

  try {
    const config = loadConfig();
    defaultSource = config.defaultSource;
    defaultModel = config.defaultModel;
    defaultCwd = config.defaultCwd;
    autoStart = config.autoStart;
  } catch {
    // Defensive: keep rendering the picker; session creation surfaces any
    // recognizable error. Never leak the underlying message here.
    defaultSource = process.env.PI_WEB_DEFAULT_SOURCE;
    autoStart = process.env.PI_WEB_AUTOSTART === "1";
  }

  return (
    <ChatApp
      defaultSource={defaultSource}
      defaultModel={defaultModel}
      defaultCwd={defaultCwd}
      autoStart={autoStart}
    />
  );
}

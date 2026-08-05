/** Host → runner credential hot-refresh bridge. */
import {
  CredentialRefreshFrameSchema,
  type CredentialRefreshFrame,
} from "@blksails/pi-web-protocol";
import type { FrameChannel, Disposable } from "./frame-channel/index.js";

export interface WireCredentialRefreshInput {
  readonly env: NodeJS.ProcessEnv;
}

/** Replace the request-time credential without restarting the runner session. */
export function wireCredentialRefreshBridge(
  channel: FrameChannel,
  input: WireCredentialRefreshInput,
): Disposable {
  const unregister = channel.register<CredentialRefreshFrame>(
    "piweb_credential_refresh",
    CredentialRefreshFrameSchema,
    (frame) => {
      if (frame.credential === null) {
        delete input.env.PI_WEB_DESKTOP_CREDENTIAL;
      } else {
        input.env.PI_WEB_DESKTOP_CREDENTIAL = frame.credential;
      }
    },
  );
  return { cleanup: unregister };
}

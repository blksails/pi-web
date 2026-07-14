// Real-subprocess fixture (agent-attachment-profile spec, task 6.1): declares a
// valid `attachmentProfile` and exposes an agent-declared-route (`put-output`)
// that calls the runner-injected AttachmentToolContext's `putOutput`, so the
// integration test can synchronously trigger a subprocess-side tool-output
// write without needing an LLM (agent-declared-routes is a non-LLM RPC channel,
// same technique as `packages/server/test/integration/agent-routes-subprocess.test.ts`).
const ATTACHMENT_CTX_KEY = "__piWebAttachmentToolContext__";

interface AttachmentToolContextLike {
  readonly available: boolean;
  putOutput(input: {
    bytes: Uint8Array;
    name: string;
    mimeType: string;
  }): Promise<{ attachmentId: string }>;
}

async function putOutputHandler(): Promise<unknown> {
  const ctx = (globalThis as Record<string, unknown>)[
    ATTACHMENT_CTX_KEY
  ] as AttachmentToolContextLike | undefined;
  if (ctx === undefined || !ctx.available) {
    return { ok: false, error: "attachment capability unavailable" };
  }
  const ref = await ctx.putOutput({
    bytes: new Uint8Array([9, 9, 9]),
    name: "profile-e2e.bin",
    mimeType: "application/octet-stream",
  });
  return { ok: true, attachmentId: ref.attachmentId };
}

export default {
  systemPrompt: "attachment-profile-e2e-agent (real-subprocess fixture)",
  // Whitelist-checked at runner assembly time against PI_WEB_ATTACHMENT_BACKENDS;
  // the test spawns this fixture with a topology declaring "primary"/"secondary".
  attachmentProfile: "secondary",
  routes: [
    {
      name: "put-output",
      methods: ["GET"],
      handler: putOutputHandler,
    },
  ],
};

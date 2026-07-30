// Real-subprocess fixture (agent-attachment-profile spec, task 6.3): does NOT
// declare `attachmentProfile` at all, so runner assembly skips whitelist
// validation entirely and never emits an `agent_attachment_profile` frame —
// used to prove disabled-toggle states leave undeclared agents' behavior
// unchanged (writes land on the host default backend either way).
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
    bytes: new Uint8Array([7, 7, 7]),
    name: "profile-undeclared.bin",
    mimeType: "application/octet-stream",
  });
  return { ok: true, attachmentId: ref.attachmentId };
}

export default {
  systemPrompt: "attachment-profile-undeclared-agent (real-subprocess fixture)",
  routes: [
    {
      name: "put-output",
      methods: ["GET"],
      handler: putOutputHandler,
    },
  ],
};

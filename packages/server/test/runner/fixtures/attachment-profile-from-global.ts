// Shape (b) factory whose `attachmentProfile` value is injected via globalThis,
// so a single fixture can drive the whole validation matrix (valid / empty /
// bad chars / omitted) from the test file (agent-attachment-profile spec).
export default () => ({
  systemPrompt: "attachment-profile-from-global agent",
  attachmentProfile: (globalThis as { __attachmentProfileFixture?: unknown })
    .__attachmentProfileFixture,
});

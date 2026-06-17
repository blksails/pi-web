// Shape (b): default export is a (ctx) => AgentDefinition factory.
// Records the received ctx on globalThis so the test can assert it was passed.
interface Ctx {
  cwd: string;
  agentDir?: string;
  env: Record<string, string | undefined>;
}

export default (ctx: Ctx) => {
  (globalThis as { __shapeBCtx?: Ctx }).__shapeBCtx = ctx;
  return {
    systemPrompt: `shape-b agent in ${ctx.cwd}`,
  };
};

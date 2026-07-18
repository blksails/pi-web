import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAgentSessionFromServices } from "@earendil-works/pi-coding-agent";
import type { AgentContext } from "../../src/runner/agent-definition.js";
import { loadAgentDefinition } from "../../src/runner/agent-loader.js";
import { makeResolveProjectTrust } from "../../src/runner/project-trust.js";

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return {
    ...actual,
    createAgentSessionServices: vi.fn().mockResolvedValue({
      modelRegistry: {},
      diagnostics: [],
    }),
    createAgentSessionFromServices: vi.fn().mockResolvedValue({}),
  };
});

const examplePath = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "examples",
  "ask-user-question-agent",
  "index.ts",
);

const ctx: AgentContext = { cwd: "/tmp/work", agentDir: "/tmp/agent", env: {} };
const trust = makeResolveProjectTrust(false);

describe("examples/ask-user-question-agent — real loader smoke", () => {
  beforeEach(() => {
    vi.mocked(createAgentSessionFromServices).mockClear();
  });

  it("loads through loadAgentDefinition and wires ask_user_question as a custom tool", async () => {
    const factory = await loadAgentDefinition(examplePath, ctx, trust);

    await factory({
      cwd: ctx.cwd,
      agentDir: ctx.agentDir,
      sessionManager: {} as never,
    });

    const sessionOptions = vi.mocked(createAgentSessionFromServices).mock.calls[0]?.[0];
    expect(sessionOptions).toBeDefined();
    expect(sessionOptions?.customTools?.map((tool) => tool.name)).toContain(
      "ask_user_question",
    );
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(import.meta.dirname, "..");

describe("ask-user-question-agent example", () => {
  it("declares the shared ask_user_question tool and decision-making guidance", () => {
    const source = readFileSync(
      resolve(repoRoot, "examples/ask-user-question-agent/index.ts"),
      "utf8",
    );

    expect(source).toContain('from "@blksails/pi-web-agent-kit"');
    expect(source).toContain('from "@blksails/pi-web-tool-kit/runtime"');
    expect(source).toMatch(/customTools:\s*\[askUserQuestionTool\]/);
    expect(source).toContain("multiple reasonable options");
    expect(source).toContain("cannot infer the user's intent");
    expect(source).toContain("Never guess");
  });

  it("ships usage documentation and is registered in the examples index", () => {
    const readme = readFileSync(
      resolve(repoRoot, "examples/ask-user-question-agent/README.md"),
      "utf8",
    );
    const index = readFileSync(resolve(repoRoot, "examples/README.md"), "utf8");

    expect(readme).toContain("pi-web ./examples/ask-user-question-agent");
    expect(readme).toContain("ask_user_question");
    expect(index).toContain("[ask-user-question-agent](./ask-user-question-agent/)");
  });
});

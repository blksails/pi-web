import { describe, expect, it } from "vitest";
import {
  parseMemoryDocument,
  serializeMemoryDocument,
} from "../../src/memory/frontmatter.js";
import type { MemoryEntry } from "../../src/memory/types.js";

const sample: MemoryEntry = {
  name: "user-prefs",
  description: "用户偏好简洁中文",
  tags: ["prefs", "style"],
  scope: "global",
  content: "请用简洁中文回复。\n代码注释用英文。",
  createdAt: "2026-07-16T08:00:00.000Z",
  updatedAt: "2026-07-16T09:00:00.000Z",
};

describe("memory frontmatter", () => {
  it("round-trips serialize → parse", () => {
    const doc = serializeMemoryDocument(sample);
    expect(doc.startsWith("---\n")).toBe(true);
    const parsed = parseMemoryDocument(doc);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entry.name).toBe(sample.name);
    expect(parsed.entry.description).toBe(sample.description);
    expect(parsed.entry.tags).toEqual(sample.tags);
    expect(parsed.entry.scope).toBe("global");
    expect(parsed.entry.content).toBe(sample.content);
    expect(parsed.entry.createdAt).toBe(sample.createdAt);
    expect(parsed.entry.updatedAt).toBe(sample.updatedAt);
  });

  it("parses agent-source with agentSourceId", () => {
    const entry: MemoryEntry = {
      ...sample,
      name: "local-notes",
      scope: "agent-source",
      agentSourceId: "hello-agent",
      tags: [],
    };
    const parsed = parseMemoryDocument(serializeMemoryDocument(entry));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.entry.scope).toBe("agent-source");
    expect(parsed.entry.agentSourceId).toBe("hello-agent");
  });

  it("rejects missing frontmatter", () => {
    const r = parseMemoryDocument("# just body\n");
    expect(r.ok).toBe(false);
  });

  it("rejects agent-source without agentSourceId", () => {
    const doc = `---
name: x
scope: agent-source
tags: []
createdAt: 2026-01-01T00:00:00.000Z
updatedAt: 2026-01-01T00:00:00.000Z
---
body
`;
    const r = parseMemoryDocument(doc);
    expect(r.ok).toBe(false);
  });
});

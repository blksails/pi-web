import { describe, expect, it } from "vitest";
import {
  EmptyConfigSchema,
  EmptySuggestionSchema,
  WebExtConfigSchema,
} from "../../src/web-ext/config.js";

describe("EmptySuggestionSchema", () => {
  it("accepts a serializable suggestion with mode fill/send", () => {
    expect(
      EmptySuggestionSchema.safeParse({
        id: "s1",
        label: "Summarize",
        value: "Please summarize",
        mode: "send",
      }).success,
    ).toBe(true);
  });

  it("rejects an invalid mode", () => {
    const r = EmptySuggestionSchema.safeParse({
      id: "s1",
      label: "x",
      value: "x",
      mode: "submit",
    });
    expect(r.success).toBe(false);
  });
});

describe("EmptyConfigSchema", () => {
  it("accepts title/subtitle/starters/mergeCommands", () => {
    const r = EmptyConfigSchema.safeParse({
      title: "需要我帮忙吗?",
      subtitle: "提出问题、编写代码或探索想法",
      starters: [{ id: "s1", label: "Hi", value: "Hi", mode: "fill" }],
      mergeCommands: "prepend",
    });
    expect(r.success).toBe(true);
  });

  it("accepts an empty object (all fields optional)", () => {
    expect(EmptyConfigSchema.safeParse({}).success).toBe(true);
  });

  it("rejects an unknown mergeCommands value", () => {
    const r = EmptyConfigSchema.safeParse({ mergeCommands: "merge" });
    expect(r.success).toBe(false);
  });

  it("rejects a starter with an invalid mode", () => {
    const r = EmptyConfigSchema.safeParse({
      starters: [{ id: "s1", label: "x", value: "x", mode: "nope" }],
    });
    expect(r.success).toBe(false);
  });
});

describe("WebExtConfigSchema with empty", () => {
  it("accepts config carrying an empty block alongside theme/layout", () => {
    const r = WebExtConfigSchema.safeParse({
      theme: { "--pw-acme-accent": "#09f" },
      layout: "split",
      empty: {
        title: "Hello",
        starters: [{ id: "s1", label: "Hi", value: "Hi", mode: "send" }],
        mergeCommands: "replace",
      },
    });
    expect(r.success).toBe(true);
  });

  it("accepts legacy config without empty (backward compatible)", () => {
    const r = WebExtConfigSchema.safeParse({
      theme: { "--pw-acme-accent": "#09f" },
      layout: "split",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.empty).toBeUndefined();
  });

  it("rejects an empty block with an invalid mergeCommands", () => {
    const r = WebExtConfigSchema.safeParse({
      empty: { mergeCommands: "x" },
    });
    expect(r.success).toBe(false);
  });
});

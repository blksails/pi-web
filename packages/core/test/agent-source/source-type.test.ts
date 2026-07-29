import { describe, it, expect } from "vitest";
import path from "node:path";
import { identify } from "../../src/agent-source/source-type.js";
import { SourceKindError } from "../../src/agent-source/errors.js";

describe("identify — source type detection", () => {
  it("recognizes absolute path as local dir", () => {
    const r = identify("/abs/agent");
    expect(r).toEqual({ kind: "dir", path: "/abs/agent" });
  });

  it("recognizes relative ./ path against opts.cwd", () => {
    const r = identify("./agent", { cwd: "/base" });
    expect(r).toEqual({ kind: "dir", path: path.resolve("/base", "./agent") });
  });

  it("recognizes relative ../ path", () => {
    const r = identify("../sibling", { cwd: "/base/here" });
    expect(r).toEqual({ kind: "dir", path: path.resolve("/base/here", "../sibling") });
  });

  it("parses git: scheme with @ref", () => {
    const r = identify("git:github.com/user/repo@v1.2.3");
    expect(r.kind).toBe("git");
    if (r.kind !== "git") throw new Error("unreachable");
    expect(r.git.host).toBe("github.com");
    expect(r.git.repoPath).toBe("user/repo");
    expect(r.git.ref).toBe("v1.2.3");
    expect(r.git.refIsDefault).toBe(false);
    expect(r.git.url).toBe("https://github.com/user/repo.git");
  });

  it("parses https URL with @ref", () => {
    const r = identify("https://github.com/user/repo@main");
    if (r.kind !== "git") throw new Error("not git");
    expect(r.git.url).toBe("https://github.com/user/repo");
    expect(r.git.ref).toBe("main");
    expect(r.git.host).toBe("github.com");
    expect(r.git.repoPath).toBe("user/repo");
  });

  it("parses ssh URL with @ref", () => {
    const r = identify("ssh://git@github.com/user/repo@abc123");
    if (r.kind !== "git") throw new Error("not git");
    expect(r.git.url).toBe("ssh://git@github.com/user/repo");
    expect(r.git.ref).toBe("abc123");
    expect(r.git.host).toBe("github.com");
  });

  it("uses default ref (HEAD) when @ref omitted and flags it", () => {
    const r = identify("git:github.com/user/repo");
    if (r.kind !== "git") throw new Error("not git");
    expect(r.git.ref).toBe("HEAD");
    expect(r.git.refIsDefault).toBe(true);
  });

  it("uses default ref for https without @ref", () => {
    const r = identify("https://github.com/user/repo");
    if (r.kind !== "git") throw new Error("not git");
    expect(r.git.ref).toBe("HEAD");
    expect(r.git.refIsDefault).toBe(true);
  });

  it("does not mistake ssh user@host for a ref", () => {
    const r = identify("ssh://git@example.com/u/r");
    if (r.kind !== "git") throw new Error("not git");
    expect(r.git.ref).toBe("HEAD");
    expect(r.git.url).toBe("ssh://git@example.com/u/r");
  });

  it("throws SourceKindError for unrecognized source (with original value)", () => {
    expect(() => identify("not-a-known-form")).toThrowError(SourceKindError);
    try {
      identify("weird-thing");
    } catch (e) {
      expect(e).toBeInstanceOf(SourceKindError);
      expect((e as SourceKindError).source).toBe("weird-thing");
    }
  });

  it("returns default kind when source is undefined", () => {
    expect(identify(undefined)).toEqual({ kind: "default" });
  });

  it("returns default kind when source is empty string", () => {
    expect(identify("")).toEqual({ kind: "default" });
  });

  it("dispatches to sourceResolver plugin when it can handle", () => {
    const plugin = {
      canHandle: (s: string) => s.startsWith("custom://"),
      resolve: async () => ({ localDir: "/x" }),
    };
    const r = identify("custom://thing", { sourceResolver: plugin });
    expect(r.kind).toBe("plugin");
    if (r.kind !== "plugin") throw new Error("not plugin");
    expect(r.source).toBe("custom://thing");
  });
});

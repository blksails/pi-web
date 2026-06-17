import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  ensureGitSource,
  deriveCachePath,
  nonInteractiveGitEnv,
  __resetInFlightForTest,
} from "../../src/agent-source/git-clone.js";
import { GitResolveError } from "../../src/agent-source/errors.js";
import type { GitSource } from "../../src/agent-source/types.js";
import { createBareRepo, type BareRepoFixture } from "./helpers.js";

let fixture: BareRepoFixture;
let cacheRoot: string;

beforeEach(async () => {
  __resetInFlightForTest();
  fixture = await createBareRepo({ withEntry: true });
  cacheRoot = await fs.mkdtemp(path.join(os.tmpdir(), "asr-cache-"));
});

afterEach(async () => {
  await fixture.cleanup();
  await fs.rm(cacheRoot, { recursive: true, force: true });
});

function gitSrc(ref: string): GitSource {
  return {
    url: fixture.bareUrl,
    ref,
    host: "local",
    repoPath: "remote",
    refIsDefault: ref === "HEAD",
  };
}

describe("nonInteractiveGitEnv", () => {
  it("forces non-interactive flags", () => {
    const env = nonInteractiveGitEnv({});
    expect(env["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(env["GIT_SSH_COMMAND"]).toContain("BatchMode=yes");
  });
});

describe("ensureGitSource — clone to cache (offline bare repo)", () => {
  it("clones to derived cache path and checks out HEAD", async () => {
    const src = gitSrc("HEAD");
    const dir = await ensureGitSource(src, cacheRoot);
    expect(dir).toBe(deriveCachePath(src, cacheRoot));
    // work tree pinned: index.ts present from the commit
    expect(await fs.stat(path.join(dir, "index.ts"))).toBeTruthy();
    expect(await fs.stat(path.join(dir, ".git"))).toBeTruthy();
  });

  it("pins to a specific tag ref", async () => {
    const src = gitSrc(fixture.tag);
    const dir = await ensureGitSource(src, cacheRoot);
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" }).stdout.trim();
    expect(head).toBe(fixture.headSha);
  });

  it("reuses existing healthy cache without recloning", async () => {
    const src = gitSrc("HEAD");
    const dir1 = await ensureGitSource(src, cacheRoot);
    // drop a marker; a reclone would wipe the dir and remove it
    const marker = path.join(dir1, ".reuse-marker");
    await fs.writeFile(marker, "x");
    const dir2 = await ensureGitSource(src, cacheRoot);
    expect(dir2).toBe(dir1);
    expect(await fs.stat(marker)).toBeTruthy(); // marker survived → no reclone
  });

  it("rebuilds when cache is corrupt (missing .git)", async () => {
    const src = gitSrc("HEAD");
    const dir = await ensureGitSource(src, cacheRoot);
    await fs.rm(path.join(dir, ".git"), { recursive: true, force: true });
    const marker = path.join(dir, ".stale");
    await fs.writeFile(marker, "x");
    const dir2 = await ensureGitSource(src, cacheRoot);
    expect(dir2).toBe(dir);
    // rebuilt → .git back, stale marker gone
    expect(await fs.stat(path.join(dir2, ".git"))).toBeTruthy();
    await expect(fs.stat(marker)).rejects.toBeTruthy();
  });

  it("dedups concurrent requests for the same source@ref to a single clone", async () => {
    const src = gitSrc("HEAD");
    const [a, b] = await Promise.all([
      ensureGitSource(src, cacheRoot),
      ensureGitSource(src, cacheRoot),
    ]);
    expect(a).toBe(b);
    expect(await fs.stat(path.join(a, "index.ts"))).toBeTruthy();
  });

  it("throws GitResolveError (no spawnSpec) on bad ref, with source+ref", async () => {
    const src = gitSrc("nonexistent-ref-xyz");
    await expect(ensureGitSource(src, cacheRoot)).rejects.toBeInstanceOf(GitResolveError);
    try {
      __resetInFlightForTest();
      await ensureGitSource(src, cacheRoot);
    } catch (e) {
      expect(e).toBeInstanceOf(GitResolveError);
      expect((e as GitResolveError).ref).toBe("nonexistent-ref-xyz");
    }
    // failed clone leaves no partial cache dir
    await expect(fs.stat(deriveCachePath(src, cacheRoot))).rejects.toBeTruthy();
  });

  it("throws GitResolveError on unreachable remote", async () => {
    const src: GitSource = {
      url: path.join(os.tmpdir(), "definitely-not-a-repo-12345"),
      ref: "HEAD",
      host: "local",
      repoPath: "missing",
      refIsDefault: true,
    };
    await expect(ensureGitSource(src, cacheRoot)).rejects.toBeInstanceOf(GitResolveError);
  });
});

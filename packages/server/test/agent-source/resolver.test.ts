import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolve, AgentSourceResolver } from "../../src/agent-source/resolver.js";
import { SpawnSpecSchema } from "@blksails/protocol";
import { createBareRepo, mkTmpDir, type BareRepoFixture } from "./helpers.js";
import { __resetInFlightForTest } from "../../src/agent-source/git-clone.js";
import { makeProjectTrustPolicy } from "../../src/trust/index.js";

const RUNNER = "/opt/pi-web/runner.js";
const PI_CLI = "/opt/pi/dist/cli.js";

let dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.map((d) => fs.rm(d, { recursive: true, force: true })));
  dirs = [];
});

async function tmp(): Promise<string> {
  const d = await mkTmpDir();
  dirs.push(d);
  return d;
}

describe("resolve — local dir WITH index → custom mode", () => {
  it("produces custom mode + runner spawnSpec pointing --agent at the index", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "index.ts"), "export default {};\n");

    const r = await resolve(dir, { runnerEntry: RUNNER, piCliEntry: PI_CLI });
    expect(r.mode).toBe("custom");
    expect(r.cwd).toBe(dir);
    expect(r.spawnSpec.cwd).toBe(dir);
    expect(r.spawnSpec.cmd).toBe("node");
    expect(r.spawnSpec.args).toContain(RUNNER);
    const agentIdx = r.spawnSpec.args.indexOf("--agent");
    expect(agentIdx).toBeGreaterThanOrEqual(0);
    expect(r.spawnSpec.args[agentIdx + 1]).toBe(path.join(dir, "index.ts"));
    expect(r.trust).toBe("ask"); // default
  });
});

describe("resolve — local dir WITHOUT index → cli mode", () => {
  it("produces cli mode + pi CLI spawnSpec", async () => {
    const dir = await tmp();
    const r = await resolve(dir, { runnerEntry: RUNNER, piCliEntry: PI_CLI });
    expect(r.mode).toBe("cli");
    expect(r.spawnSpec.cmd).toBe("node");
    expect(r.spawnSpec.args).toEqual([PI_CLI, "--mode", "rpc"]);
    expect(r.spawnSpec.cwd).toBe(dir);
  });
});

describe("resolve — default (undefined source) → cli with default cwd", () => {
  it("uses opts.cwd as work dir and cli mode", async () => {
    const dir = await tmp();
    const r = await resolve(undefined, { cwd: dir, piCliEntry: PI_CLI });
    expect(r.mode).toBe("cli");
    expect(r.cwd).toBe(dir);
    expect(r.spawnSpec.args).toEqual([PI_CLI, "--mode", "rpc"]);
  });
});

describe("resolve — trust landing", () => {
  it("cli + always → --approve in args", async () => {
    const dir = await tmp();
    const r = await resolve(dir, { piCliEntry: PI_CLI, trustPolicy: () => "always" });
    expect(r.trust).toBe("always");
    expect(r.spawnSpec.args).toContain("--approve");
  });

  it("cli + ask (headless default) → no approve flag", async () => {
    const dir = await tmp();
    const r = await resolve(dir, { piCliEntry: PI_CLI });
    expect(r.spawnSpec.args).not.toContain("--approve");
    expect(r.spawnSpec.args).not.toContain("--no-approve");
  });

  it("custom + always → PI_WEB_TRUST_PROJECT env signal to runner", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "index.ts"), "export default {};\n");
    const r = await resolve(dir, { runnerEntry: RUNNER, trustPolicy: () => "always" });
    expect(r.spawnSpec.env["PI_WEB_TRUST_PROJECT"]).toBe("1");
  });

  // 端到端(C-P1~P4):DTO trust → requestTrust → ProjectTrustPolicy("always")
  // → applyTrust(custom) → spawnSpec.env.PI_WEB_TRUST_PROJECT。runner 读该 env 后放行 .pi/。
  it("custom + requestTrust:true(经 ProjectTrustPolicy)→ PI_WEB_TRUST_PROJECT env", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "index.ts"), "export default {};\n");
    const agentDir = await tmp(); // 临时信任库,不污染 ~/.pi/agent
    const trustPolicy = makeProjectTrustPolicy({ agentDir });
    const r = await resolve(dir, {
      runnerEntry: RUNNER,
      trustPolicy,
      requestTrust: true,
    });
    expect(r.trust).toBe("always");
    expect(r.spawnSpec.env["PI_WEB_TRUST_PROJECT"]).toBe("1");
  });

  // 生产路径(无 DTO trust 时):trustedRoots 命中 dir → 放行,复刻 makeRealResolver
  // 读 PI_WEB_TRUSTED_ROOTS 的接线。证明不依赖显式 trust 也能放行受信目录。
  it("custom + trustedRoots 含 dir(无 requestTrust)→ PI_WEB_TRUST_PROJECT env", async () => {
    const dir = await tmp();
    await fs.writeFile(path.join(dir, "index.ts"), "export default {};\n");
    const agentDir = await tmp();
    const trustPolicy = makeProjectTrustPolicy({ agentDir, trustedRoots: [dir] });
    const r = await resolve(dir, { runnerEntry: RUNNER, trustPolicy });
    expect(r.trust).toBe("always");
    expect(r.spawnSpec.env["PI_WEB_TRUST_PROJECT"]).toBe("1");
  });
});

describe("resolve — agentDir isolation", () => {
  it("passes PI_CODING_AGENT_DIR via env", async () => {
    const dir = await tmp();
    const r = await resolve(dir, { piCliEntry: PI_CLI, agentDir: "/iso/agentdir" });
    expect(r.spawnSpec.env["PI_CODING_AGENT_DIR"]).toBe("/iso/agentdir");
  });
});

describe("resolve — git source (offline bare repo) integration", () => {
  let fixture: BareRepoFixture;
  let cacheRoot: string;

  beforeEach(async () => {
    __resetInFlightForTest();
    fixture = await createBareRepo({ withEntry: true });
    cacheRoot = await mkTmpDir("asr-rcache-");
    dirs.push(cacheRoot);
  });
  afterEach(async () => {
    await fixture.cleanup();
  });

  it("clones git source to cache then resolves custom mode from cloned index.ts", async () => {
    const source = `git:local/remote@${fixture.tag}`;
    // identify() would derive a github URL from git:, so use an explicit plugin-free path:
    // pass the bare path through a custom sourceResolver that clones it.
    const r = await resolve(source, {
      runnerEntry: RUNNER,
      gitCacheRoot: cacheRoot,
      sourceResolver: {
        canHandle: (s) => s === source,
        resolve: async () => {
          const { ensureGitSource } = await import("../../src/agent-source/git-clone.js");
          const localDir = await ensureGitSource(
            { url: fixture.bareUrl, ref: fixture.tag, host: "local", repoPath: "remote", refIsDefault: false },
            cacheRoot,
          );
          return { localDir };
        },
      },
    });
    expect(r.mode).toBe("custom");
    const agentIdx = r.spawnSpec.args.indexOf("--agent");
    expect(r.spawnSpec.args[agentIdx + 1]).toContain("index.ts");
    // ref pinned at the fixture commit
    const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd: r.cwd, encoding: "utf8" }).stdout.trim();
    expect(head).toBe(fixture.headSha);
  });
});

describe("e2e / cross-spec sanity — spawnSpec is launch-ready", () => {
  it("custom & cli spawnSpec satisfy protocol SpawnSpec schema and child_process.spawn shape", async () => {
    const withIdx = await tmp();
    await fs.writeFile(path.join(withIdx, "index.ts"), "export default {};\n");
    const noIdx = await tmp();

    const custom = await resolve(withIdx, { runnerEntry: RUNNER, piCliEntry: PI_CLI });
    const cli = await resolve(noIdx, { runnerEntry: RUNNER, piCliEntry: PI_CLI });

    for (const r of [custom, cli]) {
      // 1. matches @blksails/protocol SpawnSpecSchema (the contract rpc-channel consumes)
      expect(() => SpawnSpecSchema.parse(r.spawnSpec)).not.toThrow();
      // 2. structural shape matching PiRpcProcess: spawn(cmd, args, { cwd, env })
      const { cmd, args, cwd, env } = r.spawnSpec;
      expect(cmd).toBe("node");
      expect(Array.isArray(args)).toBe(true);
      expect(args.every((a) => typeof a === "string")).toBe(true);
      expect(typeof cwd).toBe("string");
      expect(typeof env).toBe("object");
      expect(Object.values(env).every((v) => typeof v === "string")).toBe(true);
    }
  });

  it("AgentSourceResolver.resolve is the single public entry returning the 4-tuple", async () => {
    const dir = await tmp();
    const r = await AgentSourceResolver.resolve(dir, { piCliEntry: PI_CLI });
    expect(Object.keys(r).sort()).toEqual(["cwd", "mode", "spawnSpec", "trust"]);
  });
});

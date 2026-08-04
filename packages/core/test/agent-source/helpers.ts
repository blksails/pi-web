import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/** 在临时位置创建一个含一次 commit 的本地 bare repo,作为离线 git 远端 mock。 */
export interface BareRepoFixture {
  /** bare repo 路径(作为 clone URL)。 */
  bareUrl: string;
  /** 默认分支上 HEAD commit 的 sha。 */
  headSha: string;
  /** 默认分支名。 */
  branch: string;
  /** 一个轻量 tag,指向首个 commit。 */
  tag: string;
  /** 清理函数。 */
  cleanup: () => Promise<void>;
}

function git(cwd: string, args: string[]): string {
  const res = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@e",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@e",
    },
  });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

/**
 * 创建 bare repo:先建工作仓 + commit(放 index.ts 入口),再 push 到 bare。
 */
export async function createBareRepo(opts?: { withEntry?: boolean }): Promise<BareRepoFixture> {
  const withEntry = opts?.withEntry ?? true;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "asr-git-"));
  const work = path.join(root, "work");
  const bare = path.join(root, "remote.git");
  const branch = "main";
  const tag = "v1";

  await fs.mkdir(work, { recursive: true });
  git(root, ["init", "--bare", "--initial-branch", branch, bare]);
  git(work, ["init", "--initial-branch", branch]);
  if (withEntry) {
    await fs.writeFile(path.join(work, "index.ts"), "export default {};\n", "utf8");
  } else {
    await fs.writeFile(path.join(work, "README.md"), "no entry\n", "utf8");
  }
  git(work, ["add", "-A"]);
  git(work, ["commit", "-m", "init"]);
  const headSha = git(work, ["rev-parse", "HEAD"]);
  git(work, ["tag", tag]);
  git(work, ["remote", "add", "origin", bare]);
  git(work, ["push", "origin", branch, "--tags"]);

  return {
    bareUrl: bare,
    headSha,
    branch,
    tag,
    cleanup: () => fs.rm(root, { recursive: true, force: true }),
  };
}

/** 创建一个临时目录 fixture。 */
export async function mkTmpDir(prefix = "asr-dir-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

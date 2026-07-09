// @vitest-environment node
/**
 * AgentInstaller 单测(spec cli-package-commands,任务 4.4,Req 3.6, 3.12)。
 *
 * 全程注入 `CommandRunner` / `TarballDownloader` 替身,绝不真的 spawn
 * `git`/`npm`/`tar` 子进程,也绝不发起任何网络请求。覆盖:
 *   - Req 3.6(观察态,git):安装一个 git 来源 agent → 目录出现在 sourcesRoot 之下。
 *   - Req 3.6(观察态,npm):安装一个 npm 来源 agent → 目录出现在 sourcesRoot 之下,
 *     且 `npm` 调用只有 `view`(不下载/不安装/不执行脚本)。
 *   - 本地路径(观察态):安装一个本地路径来源 → sourcesRoot 下无新目录,
 *     而 sources.json 新增一条(真调用 4.1 的 registerLocalSource)。
 *   - Req 3.12:命令序列白名单断言(git 只能是 init/remote/fetch/checkout;
 *     npm 只能是 view),不含任何会触发包脚本的调用。
 *   - 回滚:git fetch 失败 → 目标目录不存在,staging 已清理。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  installAgentSource,
  uninstallAgentSource,
  type CommandRunner,
  type CommandResult,
  type TarballDownloader,
} from "@/server/cli/install/agent-installer";

let root: string;
let sourcesRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "agent-installer-test-"));
  sourcesRoot = join(root, "sources-root");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface RecordedCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

/** 记录调用并按注册的处理器分派;处理器可对 cwd 做真实文件写入以模拟子进程副作用。 */
function makeRecordingRunner(
  handlers: Record<string, (args: readonly string[], cwd?: string) => CommandResult | Promise<CommandResult>>,
): { runCommand: CommandRunner; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const runCommand: CommandRunner = async (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd });
    const handler = handlers[command];
    if (handler === undefined) {
      throw new Error(`unexpected command invoked in test: ${command} ${args.join(" ")}`);
    }
    return handler(args, options?.cwd);
  };
  return { runCommand, calls };
}

const OK: CommandResult = { ok: true, code: 0, stdout: "", stderr: "" };
function fail(stderr: string): CommandResult {
  return { ok: false, code: 1, stdout: "", stderr };
}

describe("installAgentSource: git 来源(Req 3.6 观察态)", () => {
  it("成功的浅克隆序列后,目录出现在 sourcesRoot 之下", async () => {
    const { runCommand, calls } = makeRecordingRunner({
      git: (args, cwd) => {
        // 模拟真实 git 的落盘副作用:checkout 后 staging 目录里出现文件。
        if (args[0] === "checkout" && cwd !== undefined) {
          writeFileSync(join(cwd, "pi-web.json"), JSON.stringify({ kind: "agent" }));
        }
        return OK;
      },
    });

    const result = await installAgentSource(
      { kind: "git", host: "github.com", repoPath: "acme/my-agent", ref: "v1.2.3" },
      { sourcesRoot, runCommand },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.method).toBe("git");
    expect(result.value.created).toBe(true);
    expect(existsSync(result.value.location)).toBe(true);
    // 目录确实出现在 sourcesRoot 之下(观察态)。
    expect(result.value.location.startsWith(sourcesRoot)).toBe(true);
    expect(readFileSync(join(result.value.location, "pi-web.json"), "utf8")).toContain("agent");
    // 克隆产物不应残留 .git(「不可变引用」)。
    expect(existsSync(join(result.value.location, ".git"))).toBe(false);
    // sourcesRoot 下不应残留任何 .staging- 目录。
    const leftovers = readdirSync(sourcesRoot).filter((n) => n.startsWith(".staging-"));
    expect(leftovers).toHaveLength(0);

    expect(calls.map((c) => c.args[0])).toEqual(["init", "remote", "fetch", "checkout"]);
  });

  it("重复安装同一 ref 时幂等短路,不重新调用 git", async () => {
    const { runCommand, calls } = makeRecordingRunner({
      git: (args, cwd) => {
        if (args[0] === "checkout" && cwd !== undefined) {
          writeFileSync(join(cwd, "marker.txt"), "x");
        }
        return OK;
      },
    });
    const source = { kind: "git" as const, host: "github.com", repoPath: "acme/my-agent", ref: "v1.2.3" };

    const first = await installAgentSource(source, { sourcesRoot, runCommand });
    expect(first.ok).toBe(true);

    const second = await installAgentSource(source, { sourcesRoot, runCommand });
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.created).toBe(false);
      expect(second.value.location).toBe(first.ok ? first.value.location : "");
    }
    // 第二次安装未产生任何新的 git 调用。
    expect(calls).toHaveLength(4);
  });
});

describe("installAgentSource: npm 来源(Req 3.6 观察态, 3.12 脚本安全)", () => {
  function makeNpmSetup(): {
    runCommand: CommandRunner;
    downloadTarball: TarballDownloader;
    calls: RecordedCall[];
    downloadedUrls: string[];
  } {
    const downloadedUrls: string[] = [];
    const { runCommand, calls } = makeRecordingRunner({
      // ★ 刻意「宽松」:对**任何** npm 子命令都返回成功,且都返回一个合法的 tarball URL。
      // 若替身只放行 `view`、对 install/pack 直接失败(或返回空 stdout 导致解析失败),
      // 那么「不得执行包脚本」的白名单断言就永远触达不到 —— 违规会在更早的「调用失败」层
      // 被拦下,断言沦为摆设(复核指出的原缺陷)。让替身一路放行到底,把拦截责任完全交给
      // 下面那条白名单断言,它才是真正的防线。
      npm: () => ({
        ok: true,
        code: 0,
        stdout: JSON.stringify("https://registry.example/tarball.tgz"),
        stderr: "",
      }),
      tar: (args) => {
        // 模拟 tar 解包副作用:在目标目录写入一个文件。
        const dashCIndex = args.indexOf("-C");
        const destDir = dashCIndex >= 0 ? args[dashCIndex + 1] : undefined;
        if (destDir !== undefined) {
          writeFileSync(join(destDir, "pi-web.json"), JSON.stringify({ kind: "agent" }));
        }
        return OK;
      },
    });
    const downloadTarball: TarballDownloader = async (url) => {
      downloadedUrls.push(url);
      return Buffer.from("fake-tarball-bytes");
    };
    return { runCommand, downloadTarball, calls, downloadedUrls };
  }

  it("成功获取并解包发布产物后,目录出现在 sourcesRoot 之下", async () => {
    const { runCommand, downloadTarball, calls, downloadedUrls } = makeNpmSetup();

    const result = await installAgentSource(
      { kind: "npm", name: "my-agent", version: "1.0.0" },
      { sourcesRoot, runCommand, downloadTarball },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.method).toBe("npm");
    expect(existsSync(result.value.location)).toBe(true);
    expect(result.value.location.startsWith(sourcesRoot)).toBe(true);
    expect(readFileSync(join(result.value.location, "pi-web.json"), "utf8")).toContain("agent");
    // tarball 临时文件不应残留在最终目录里。
    expect(existsSync(join(result.value.location, "package.tgz"))).toBe(false);

    expect(downloadedUrls).toEqual(["https://registry.example/tarball.tgz"]);
    // Req 3.12 核心断言:npm 调用序列里唯一的子命令是 "view"。
    const npmCalls = calls.filter((c) => c.command === "npm");
    expect(npmCalls.map((c) => c.args[0])).toEqual(["view"]);
    for (const c of npmCalls) {
      expect(c.args).not.toContain("install");
      expect(c.args).not.toContain("pack");
      expect(c.args).not.toContain("ci");
      expect(c.args).not.toContain("run-script");
    }
  });

  it("npm view 失败时回滚,不留半成品目录", async () => {
    const { runCommand } = makeRecordingRunner({
      npm: () => fail("npm ERR! 404 Not Found"),
    });

    const result = await installAgentSource(
      { kind: "npm", name: "missing-agent", version: "9.9.9" },
      { sourcesRoot, runCommand, downloadTarball: async () => Buffer.from("") },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("NPM_VIEW_FAILED");
    // sourcesRoot 下不应存在任何目录(既无最终目录,也无残留 staging)。
    if (existsSync(sourcesRoot)) {
      expect(readdirSync(sourcesRoot)).toHaveLength(0);
    }
  });
});

describe("installAgentSource: 本地路径来源(观察态)", () => {
  it("登记本地目录后,sourcesRoot 下无新目录,而登记表新增一条", async () => {
    const localDir = join(root, "my-local-agent");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, "index.ts"), "export default {};\n");
    const registryPath = join(root, "agent-dir", "sources.json");

    // ★ 预先创建源根并放一个哨兵,模拟真实用户场景(此前已装过别的 agent)。
    // 旧断言是 `existsSync(sourcesRoot) === false`,它依赖「源根从未被创建」这一巧合前提;
    // 真实源根通常早已存在,那条断言便证明不了「不拷贝目录」。改为对比安装前后的内容快照。
    mkdirSync(join(sourcesRoot, "pre-existing-agent"), { recursive: true });
    const before = readdirSync(sourcesRoot).sort();

    const result = await installAgentSource(
      { kind: "local", path: localDir },
      { sourcesRoot, registryPath },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toBe("local");
      expect(result.value.created).toBe(true);
    }

    // 本地来源只登记、不拷贝:源根内容一字未变(既无新目录,也无 staging 残留)。
    expect(readdirSync(sourcesRoot).sort()).toEqual(before);

    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as {
      sources: Array<{ source: string }>;
    };
    expect(raw.sources).toHaveLength(1);
  });
});

describe("uninstallAgentSource(任务 4.5 缺口 1:Req 3.8)", () => {
  it("本地登记来源:sources.json 条目消失,且用户的本地目录仍然存在(不被删)", async () => {
    const localDir = join(root, "my-local-agent");
    mkdirSync(localDir, { recursive: true });
    writeFileSync(join(localDir, "index.ts"), "export default {};\n");
    const registryPath = join(root, "agent-dir", "sources.json");

    const installed = await installAgentSource(
      { kind: "local", path: localDir },
      { sourcesRoot, registryPath },
    );
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    const raw = JSON.parse(readFileSync(registryPath, "utf8")) as { sources: unknown[] };
    expect(raw.sources).toHaveLength(1);

    const result = await uninstallAgentSource(installed.value.location, { sourcesRoot, registryPath });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toBe("local");
    }

    const rawAfter = JSON.parse(readFileSync(registryPath, "utf8")) as { sources: unknown[] };
    expect(rawAfter.sources).toHaveLength(0);
    // 用户的本地目录本身必须原封不动。
    expect(existsSync(localDir)).toBe(true);
    expect(existsSync(join(localDir, "index.ts"))).toBe(true);
  });

  it("源根下的目录(git/npm 安装产物):目录被删除", async () => {
    const dirName = "git-github.com-acme-my-agent-v1.2.3";
    const target = join(sourcesRoot, dirName);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "pi-web.json"), JSON.stringify({ kind: "agent" }));
    expect(existsSync(target)).toBe(true);

    const result = await uninstallAgentSource(dirName, { sourcesRoot });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.method).toBe("directory");
    }
    expect(existsSync(target)).toBe(false);
  });

  it("路径逃逸防护:id 为 '../evil' 时拒绝,源根之外的哨兵目录未被删除", async () => {
    mkdirSync(sourcesRoot, { recursive: true });
    const sentinel = join(root, "evil");
    mkdirSync(sentinel, { recursive: true });
    writeFileSync(join(sentinel, "sentinel.txt"), "do-not-delete");
    expect(existsSync(sentinel)).toBe(true);

    const result = await uninstallAgentSource("../evil", { sourcesRoot });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PATH_ESCAPE");
    }
    // 源根之外的目标必须原封不动。
    expect(existsSync(sentinel)).toBe(true);
    expect(existsSync(join(sentinel, "sentinel.txt"))).toBe(true);
  });

  it("未安装:返回 NOT_INSTALLED,不抛异常", async () => {
    mkdirSync(sourcesRoot, { recursive: true });

    const result = await uninstallAgentSource("nonexistent-thing", { sourcesRoot });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_INSTALLED");
    }
  });

  it("除名一个不存在的登记项 -> 明确的 NOT_INSTALLED(幂等,非静默成功)", async () => {
    const registryPath = join(root, "agent-dir", "sources.json");
    mkdirSync(sourcesRoot, { recursive: true });

    const result = await uninstallAgentSource(join(root, "never-registered"), {
      sourcesRoot,
      registryPath,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("NOT_INSTALLED");
    }
  });
});

describe("installAgentSource: 回滚(git 失败)", () => {
  it("git fetch 失败时,目标目录不存在,不留半成品", async () => {
    const { runCommand, calls } = makeRecordingRunner({
      git: (args) => {
        if (args[0] === "fetch") return fail("fatal: couldn't find remote ref v9.9.9");
        return OK;
      },
    });

    const result = await installAgentSource(
      { kind: "git", host: "github.com", repoPath: "acme/broken", ref: "v9.9.9" },
      { sourcesRoot, runCommand },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("GIT_CLONE_FAILED");
    expect(calls.map((c) => c.args[0])).toEqual(["init", "remote", "fetch"]);

    // 目标目录不存在;sourcesRoot 下也不应残留任何 staging 目录。
    const expectedDirName = "git-github.com-acme-broken-v9.9.9";
    expect(existsSync(join(sourcesRoot, expectedDirName))).toBe(false);
    if (existsSync(sourcesRoot)) {
      const leftovers = readdirSync(sourcesRoot).filter((n) => n.startsWith(".staging-"));
      expect(leftovers).toHaveLength(0);
    }
  });
});

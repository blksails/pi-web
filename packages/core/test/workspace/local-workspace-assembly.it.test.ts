import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalWorkspace,
  createLocalWorkspaceNamespace,
  resolveLocalWorkspaceRoots,
} from "../../src/workspace/local-workspace.js";
import {
  DEFAULT_WORKSPACE_MAX_VALUE_BYTES,
  WORKSPACE_MAX_VALUE_BYTES_ENV,
} from "../../src/workspace/limit-config.js";
import { HOST_CONTRACT_VERSION } from "../../src/host-contract-version.js";
import type { WorkspaceErrorCode } from "../../src/workspace/types.js";

/**
 * host-contract-ports 任务 4.3 —— 双根装配与上限接线(Req 4.1-4.4、3.1;根默认位置见
 * 契约 §3.5)。
 *
 * ⚠ 断言口径:运行期错误按稳定判别码 `code` 判定,不用 `instanceof`(与
 * `src/workspace/types.ts` 的跨仓约定一致);装配期配置错误按 `name` 判定
 * ——它刻意不属于那四个运行期判别码。
 */

let userRoot: string;
let projectRoot: string;

beforeEach(async () => {
  userRoot = await fs.mkdtemp(join(tmpdir(), "pi-web-ws-user-"));
  projectRoot = await fs.mkdtemp(join(tmpdir(), "pi-web-ws-project-"));
});

afterEach(async () => {
  await fs.rm(userRoot, { recursive: true, force: true });
  await fs.rm(projectRoot, { recursive: true, force: true });
});

/** 取错误的判别码;非 Workspace 错误返回 undefined,使断言失败信息可读。 */
function codeOf(err: unknown): WorkspaceErrorCode | undefined {
  if (err !== null && typeof err === "object" && "code" in err) {
    return (err as { code?: WorkspaceErrorCode }).code;
  }
  return undefined;
}

async function expectCode(fn: () => Promise<unknown>, code: WorkspaceErrorCode) {
  let caught: unknown;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  expect(caught, "预期抛出错误但调用成功了").toBeDefined();
  expect(codeOf(caught)).toBe(code);
}

/** 构造一个字节数已知的值:紧凑序列化后必定超过 `bytes` 的粗略下界。 */
function valueOfAtLeast(bytes: number): Record<string, unknown> {
  return { blob: "x".repeat(bytes) };
}

describe("双根装配(Req 4.1-4.4;契约 §3.3 两个根不可合并)", () => {
  it("★ 同键分写两根各自独立读回:两根共享同一存储的实现在此必红", async () => {
    const ws = createLocalWorkspace({ userRoot, projectRoot });

    await ws.user.writeJson("settings.json", { scope: "user" });
    await ws.project.writeJson("settings.json", { scope: "project" });

    // 若两根其实指向同一处,后写的 project 值会盖掉 user 值(merge 缺省 true 时同字段被替换),
    // 此处 user 读回的将是 "project"。
    expect(await ws.user.readJson("settings.json")).toEqual({ scope: "user" });
    expect(await ws.project.readJson("settings.json")).toEqual({ scope: "project" });
  });

  it("★ 落点在物理上分属两个根目录:证明隔离来自根本身而非写入顺序", async () => {
    const ws = createLocalWorkspace({ userRoot, projectRoot });
    await ws.user.writeJson("only-user.json", { v: 1 });
    await ws.project.writeJson("only-project.json", { v: 1 });

    // 各自的值必须落在**自己**的根下,且不得出现在对方根下。四条合起来对
    // 「两根指向同一目录」「project 根被错接成 user 根」两类实现都会红
    // ——只断言「写 user 后 projectRoot 无此文件」是不够的:project 根被错接到 user 根时,
    // projectRoot 目录始终为空,那条恒真。
    await expect(fs.readFile(join(userRoot, "only-user.json"), "utf8")).resolves.toContain(
      '"v"',
    );
    await expect(
      fs.readFile(join(projectRoot, "only-project.json"), "utf8"),
    ).resolves.toContain('"v"');
    await expect(fs.access(join(projectRoot, "only-user.json"))).rejects.toThrow();
    await expect(fs.access(join(userRoot, "only-project.json"))).rejects.toThrow();
  });

  it("★ 一根删除不影响另一根的同名键(Req 4.3)", async () => {
    const ws = createLocalWorkspace({ userRoot, projectRoot });
    await ws.user.writeJson("d.json", { v: "user" });
    await ws.project.writeJson("d.json", { v: "project" });

    await ws.user.delete("d.json");

    expect(await ws.user.exists("d.json")).toBe(false);
    expect(await ws.project.exists("d.json")).toBe(true);
    expect(await ws.project.readJson("d.json")).toEqual({ v: "project" });
  });

  it("★ 一根的列举不返回另一根的键(Req 4.4)", async () => {
    const ws = createLocalWorkspace({ userRoot, projectRoot });
    await ws.user.writeJson("g/u.json", { v: 1 });
    await ws.project.writeJson("g/p.json", { v: 1 });

    expect(await ws.user.list("g")).toEqual(["g/u.json"]);
    expect(await ws.project.list("g")).toEqual(["g/p.json"]);
  });

  it("契约版本随实例暴露,取自唯一事实源(Req 9.1)", () => {
    const ws = createLocalWorkspace({ userRoot, projectRoot });
    expect(ws.contractVersion).toBe(HOST_CONTRACT_VERSION);
  });
});

describe("根的默认位置(契约 §3.5)", () => {
  it("★ 用户根默认取 PI_WEB_AGENT_DIR;项目根默认为 <cwd>/.pi", () => {
    const roots = resolveLocalWorkspaceRoots(
      { PI_WEB_AGENT_DIR: "/custom/agent" } as NodeJS.ProcessEnv,
      "/work/proj",
    );
    expect(roots).toEqual({
      userRoot: "/custom/agent",
      projectRoot: join("/work/proj", ".pi"),
    });
  });

  it("★ 未设 PI_WEB_AGENT_DIR 时用户根回落 ~/.pi/agent(而非 cwd 或项目根)", () => {
    const roots = resolveLocalWorkspaceRoots({} as NodeJS.ProcessEnv, "/work/proj");
    expect(roots.userRoot).toBe(join(homedir(), ".pi", "agent"));
    expect(roots.projectRoot).toBe(join("/work/proj", ".pi"));
  });

  it("★ 显式传入的根优先于默认解析", () => {
    const ws = createLocalWorkspace({
      userRoot,
      projectRoot,
      env: { PI_WEB_AGENT_DIR: "/should/not/be/used" } as NodeJS.ProcessEnv,
    });
    // 若装配层无视显式参数改用 env,下面这次写入会落到 /should/not/be/used(权限失败或写错地方)。
    return ws.user.writeJson("k.json", { v: 1 }).then(async () => {
      await expect(fs.readFile(join(userRoot, "k.json"), "utf8")).resolves.toContain('"v"');
    });
  });
});

describe("上限接线(Req 3.1-3.3;契约 §3.2.1)", () => {
  it("★ 缺省上限取自注入 env 的解析结果,且两根都生效", async () => {
    const ws = createLocalWorkspace({
      userRoot,
      projectRoot,
      env: { [WORKSPACE_MAX_VALUE_BYTES_ENV]: "200" } as NodeJS.ProcessEnv,
    });

    // 300 字节 > 200:两根都必须拒。只给 user 接上限的实现会在第二条红。
    await expectCode(() => ws.user.writeJson("big.json", valueOfAtLeast(300)), "limit");
    await expectCode(() => ws.project.writeJson("big.json", valueOfAtLeast(300)), "limit");
    // 小值仍可写,证明拒绝来自上限而非「全都写不进去」。
    await ws.user.writeJson("small.json", { v: 1 });
    expect(await ws.user.readJson("small.json")).toEqual({ v: 1 });
  });

  it("★ env 未设时取契约默认 1 MiB:略超默认的值被拒", async () => {
    const ws = createLocalWorkspace({ userRoot, projectRoot, env: {} as NodeJS.ProcessEnv });
    await expectCode(
      () => ws.user.writeJson("huge.json", valueOfAtLeast(DEFAULT_WORKSPACE_MAX_VALUE_BYTES + 1)),
      "limit",
    );
    // 默认值以内正常写入 —— 若实现把上限错设成很小的值,这条会红。
    await ws.user.writeJson(
      "ok.json",
      valueOfAtLeast(DEFAULT_WORKSPACE_MAX_VALUE_BYTES - 1024),
    );
    expect(await ws.user.exists("ok.json")).toBe(true);
  });

  it("★ 构造参数覆盖 env:取的是参数值本身,不是两者的较小者", async () => {
    const ws = createLocalWorkspace({
      userRoot,
      projectRoot,
      env: { [WORKSPACE_MAX_VALUE_BYTES_ENV]: "100" } as NodeJS.ProcessEnv,
      maxValueBytes: 5000,
    });
    // env=100 更小。若实现取 min(env, param) 或干脆无视参数,300 字节的写入会被拒 → 红。
    await ws.user.writeJson("mid.json", valueOfAtLeast(300));
    expect(await ws.user.exists("mid.json")).toBe(true);
    // 参数值本身仍是有效上限,不是「传了参数就不限」。
    await expectCode(() => ws.user.writeJson("over.json", valueOfAtLeast(6000)), "limit");
  });

  it("★ env 非法 → 装配期即抛,而不是等到第一次写入(Req 3.3)", () => {
    let caught: unknown;
    try {
      createLocalWorkspace({
        userRoot,
        projectRoot,
        env: { [WORKSPACE_MAX_VALUE_BYTES_ENV]: "1MB" } as NodeJS.ProcessEnv,
      });
    } catch (err) {
      caught = err;
    }
    // 惰性解析的实现(构造成功、writeJson 时才抛)在此必红。
    expect(caught, "构造应当抛出,但它成功返回了实例").toBeDefined();
    expect((caught as Error).name).toBe("WorkspaceConfigError");
  });

  it("★ env 非法时即便显式给了上限也照抛:非法配置不得被静默忽略", () => {
    expect(() =>
      createLocalWorkspace({
        userRoot,
        projectRoot,
        env: { [WORKSPACE_MAX_VALUE_BYTES_ENV]: "-1" } as NodeJS.ProcessEnv,
        maxValueBytes: 4096,
      }),
    ).toThrow(/PI_WEB_WORKSPACE_MAX_VALUE_BYTES/);
  });
});

/**
 * 参数路径的上限校验(复核追加)。
 *
 * ★ 靶心是 `NaN`:写时校验是 `size > maxValueBytes`,而 `size > NaN` **恒为 false**
 * ⇒ 上限完全静默失效,任意大的值都能写进去。这正是 env 路径 fail-fast 要消灭的病,
 * 两条入口的口径不该分裂。其余四种形态(`Infinity`/`0`/负数/小数)则会让写入全被拒或
 * 上限失真,同样属装配期就该拦下的配置错误。
 */
describe("显式上限的取值校验(与 env 路径同口径)", () => {
  const illegal: ReadonlyArray<readonly [string, number]> = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["0", 0],
    ["负数", -1],
    ["小数", 1.5],
  ];

  for (const [label, value] of illegal) {
    it(`★ 命名空间工厂:上限为 ${label} 时装配期即抛`, () => {
      let caught: unknown;
      try {
        createLocalWorkspaceNamespace(userRoot, { maxValueBytes: value });
      } catch (err) {
        caught = err;
      }
      expect(caught, `上限 ${label} 被接受了`).toBeDefined();
      expect((caught as Error).name).toBe("WorkspaceConfigError");
      expect((caught as Error).message).toContain("maxValueBytes");
    });

    it(`★ 装配入口:上限为 ${label} 时同样抛(不因经装配层转发而放行)`, () => {
      expect(() =>
        createLocalWorkspace({ userRoot, projectRoot, maxValueBytes: value }),
      ).toThrow(/maxValueBytes/);
    });
  }
});

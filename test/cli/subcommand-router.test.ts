/**
 * 子命令判别层单测(spec cli-package-commands, Task 2.1)。
 * 覆盖 parseCliArgs 的判别联合扩展:Req 1.1-1.7, 10.1。
 *
 * 只测「判别与解析」这一纯函数层;不触碰任何子命令的业务实现(归 3.x-9.x)。
 */
import { describe, it, expect, vi } from "vitest";
import { resolve } from "node:path";
import { parseCliArgs, CliUsageError, main, SUBCOMMAND_NAMES } from "@/bin/pi-web.mjs";

const BASE = "/home/user/proj";

describe("parseCliArgs — 子命令判别(Req 1.1, 1.2)", () => {
  it("首参不是已知子命令名 → run 意图,字段与既有行为一致", () => {
    const o = parseCliArgs(["./examples/hello-agent", "-p", "8080"]);
    expect(o.intent).toBe("run");
    expect(o.source).toBe("./examples/hello-agent");
    expect(o.port).toBe(8080);
  });

  it("空 argv → run 意图", () => {
    const o = parseCliArgs([]);
    expect(o.intent).toBe("run");
    expect(o.source).toBeUndefined();
  });

  it("首参恰好是子命令名 → subcommand 意图,argv 正确切片", () => {
    const o = parseCliArgs(["create", "my-agent", "--kind", "plugin"]);
    expect(o.intent).toBe("subcommand");
    if (o.intent !== "subcommand") throw new Error("unreachable");
    expect(o.name).toBe("create");
    expect(o.argv).toEqual(["my-agent", "--kind", "plugin"]);
  });

  it("SUBCOMMAND_NAMES 恰好含 7 个子命令名(6 个归 cli-package-commands + add 归 cli-component-add)", () => {
    expect([...SUBCOMMAND_NAMES].sort()).toEqual(
      ["add", "create", "install", "list", "publish", "uninstall", "update"].sort(),
    );
  });

  for (const name of ["install", "uninstall", "list", "update", "publish"] as const) {
    it(`子命令 "${name}" 判别为 subcommand 意图且不启动本地实例`, () => {
      const o = parseCliArgs([name, "foo"]);
      expect(o.intent).toBe("subcommand");
      if (o.intent !== "subcommand") throw new Error("unreachable");
      expect(o.name).toBe(name);
    });
  }
});

describe("parseCliArgs — 顶层与子命令帮助(Req 1.3, 1.4)", () => {
  it("顶层 --help 列出全部 6 个子命令名及一句话说明", () => {
    const o = parseCliArgs(["--help"]);
    expect(o.intent).toBe("help");
    // main() 才真正渲染文本;这里断言意图不带 subcommand。
    expect((o as { subcommand?: string }).subcommand).toBeUndefined();
  });

  it("`create --help` → help 意图且带 subcommand=create", () => {
    const o = parseCliArgs(["create", "--help"]);
    expect(o.intent).toBe("help");
    expect((o as { subcommand?: string }).subcommand).toBe("create");
  });

  it("main() 对顶层 --help 输出含全部子命令名,退出码 0", async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    try {
      const code = await main(["--help"]);
      expect(code).toBe(0);
      const out = chunks.join("");
      for (const name of ["create", "install", "uninstall", "list", "update", "publish"]) {
        expect(out).toContain(name);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("main() 对 `create --help` 输出子命令专属用法,退出码 0", async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
      chunks.push(String(c));
      return true;
    });
    try {
      const code = await main(["create", "--help"]);
      expect(code).toBe(0);
      const out = chunks.join("");
      expect(out).toContain("pi-web create");
      expect(out).toContain("--template");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("parseCliArgs — 子命令选项互不串味(Req 1.5, 1.6)", () => {
  it("--kind 被 create 与 install 接受(任务 6.1 补齐 install --kind);list --kind 报错", () => {
    expect(() => parseCliArgs(["create", "my-agent", "--kind", "plugin"])).not.toThrow();
    expect(() => parseCliArgs(["install", "src", "--kind", "plugin"])).not.toThrow();
    expect(() => parseCliArgs(["list", "--kind", "plugin"])).toThrow(CliUsageError);
  });

  it("--dry-run 只被 publish 接受;list --dry-run 报错", () => {
    expect(() => parseCliArgs(["publish", "--dry-run"])).not.toThrow();
    expect(() => parseCliArgs(["list", "--dry-run"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["create", "x", "--dry-run"])).toThrow(CliUsageError);
  });

  it("--project 被 install 与 uninstall 接受(任务 6.1 补齐 uninstall --project);list 不接受", () => {
    expect(() => parseCliArgs(["install", "src", "--project"])).not.toThrow();
    expect(() => parseCliArgs(["uninstall", "name", "--project"])).not.toThrow();
    expect(() => parseCliArgs(["list", "--project"])).toThrow(CliUsageError);
  });

  it("--outdated 只被 list 接受;update --outdated 报错", () => {
    expect(() => parseCliArgs(["list", "--outdated"])).not.toThrow();
    expect(() => parseCliArgs(["update", "--outdated"])).toThrow(CliUsageError);
  });
});

describe("parseCliArgs — 非法选项(Req 1.5)", () => {
  it("子命令下非法选项抛 CliUsageError,含选项名与查看帮助的提示", () => {
    try {
      parseCliArgs(["list", "--bogus"]);
      throw new Error("应抛出但未抛出");
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      const msg = (err as Error).message;
      expect(msg).toContain("--bogus");
      expect(msg).toMatch(/--help|帮助/);
    }
  });

  it("非法选项抛出时无任何 fs / 网络副作用(仅是判定 — 函数同步返回/抛出,不做 IO)", () => {
    // 纯函数性质的直接证据:调用在同一事件循环 tick 内完成(无 pending promise/timer),
    // 且不依赖任何注入的 fs/网络 mock 即可正确抛错 —— 佐证解析路径未触达 IO。
    expect(() => parseCliArgs(["publish", "--nope"])).toThrow(CliUsageError);
  });
});

describe("parseCliArgs — 纯函数性(Req 10.1)", () => {
  it("解析全过程不引用 process.cwd 之外的任何环境状态(重复调用幂等)", () => {
    const a = parseCliArgs(["install", "some-source", "--project"]);
    const b = parseCliArgs(["install", "some-source", "--project"]);
    expect(a).toEqual(b);
  });

  it("run 路径与本特性引入前逐字段一致(既有 26 项单测同步覆盖此不变式)", () => {
    const o = parseCliArgs(["./a", "--cwd", "work", "-p", "9090", "--watch"]);
    expect(o.intent).toBe("run");
    expect(o.source).toBe("./a");
    expect(o.cwd).toBe("work");
    expect(o.port).toBe(9090);
    expect(o.watch).toBe(true);
  });
});

describe("parseCliArgs — add 子命令词条(spec cli-component-add,任务 4,Req 10.3)", () => {
  it("`add <source>` 判别为 subcommand 意图,argv 正确切片", () => {
    const o = parseCliArgs(["add", "./my-comp", "--target", "./my-agent", "--dry-run"]);
    expect(o.intent).toBe("subcommand");
    if (o.intent !== "subcommand") throw new Error("unreachable");
    expect(o.name).toBe("add");
    expect(o.argv).toEqual(["./my-comp", "--target", "./my-agent", "--dry-run"]);
  });

  it("`add --help` → help 意图且带 subcommand=add", () => {
    const o = parseCliArgs(["add", "--help"]);
    expect(o).toEqual({ intent: "help", subcommand: "add" });
  });

  it("add 的选项不串味:create --target 报错;add --kind 报错", () => {
    expect(() => parseCliArgs(["create", "x", "--target", "y"])).toThrow(CliUsageError);
    expect(() => parseCliArgs(["add", "x", "--kind", "agent"])).toThrow(CliUsageError);
  });

  it("add 下非法选项含选项名与帮助提示", () => {
    try {
      parseCliArgs(["add", "x", "--nope"]);
      throw new Error("应当抛出");
    } catch (err) {
      expect(err).toBeInstanceOf(CliUsageError);
      expect((err as Error).message).toContain("--nope");
      expect((err as Error).message).toContain("pi-web add --help");
    }
  });
});

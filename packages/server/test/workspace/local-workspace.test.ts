import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalWorkspaceNamespace,
  resolveWorkspaceKeyPath,
} from "../../src/workspace/local-workspace.js";
import type { WorkspaceErrorCode } from "../../src/workspace/types.js";

/**
 * host-contract-ports 任务 4.1 —— 本地实现的键映射、基本读写与合并落地
 * (Req 2.1/2.2/2.3/2.4/2.5/2.7/2.8/2.9)。
 *
 * ⚠ 断言口径:错误一律按稳定判别码 `code` 判定,不用 `instanceof`——与
 * `src/workspace/types.ts` 的跨仓约定一致。
 *
 * 本任务**不覆盖**原子写入/落盘权限/上限校验(任务 4.2)与双根装配(任务 4.3),
 * 故本文件只驱动单命名空间工厂。
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "pi-web-local-ws-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
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

describe("键映射(Req 1.1 纵深防御)", () => {
  it("★ 多段键映射为根目录下的相对路径,且用平台分隔符拼接而非字符串连接", () => {
    // 对「用 `root + '/' + key` 字符串连接」的实现:在 Windows 上分隔符不一致会失败;
    // path.join 才产出平台正确的路径。断言直接比对 join 结果。
    expect(resolveWorkspaceKeyPath(root, "sources/acme/settings.json")).toBe(
      join(root, "sources", "acme", "settings.json"),
    );
    // 结果必须仍在根之下,且确实用了平台分隔符。
    expect(resolveWorkspaceKeyPath(root, "a/b.json").startsWith(root + sep)).toBe(true);
  });

  it("非法键在触及存储之前即抛键错误", async () => {
    expect(() => resolveWorkspaceKeyPath(root, "../escape.json")).toThrow();
    expect(codeOf(getThrown(() => resolveWorkspaceKeyPath(root, "../escape.json")))).toBe(
      "key",
    );
    const ns = createLocalWorkspaceNamespace(root);
    await expectCode(() => ns.writeJson("../escape.json", { a: 1 }), "key");
    // 关键:不得在抛错前落下任何东西——根目录应仍为空。
    expect(await fs.readdir(root)).toEqual([]);
  });
});

function getThrown(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

describe("读取(Req 2.1/2.2)", () => {
  it("缺失键读为空对象且不抛(Req 2.1)", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    expect(await ns.readJson("missing.json")).toEqual({});
    // 读缺失不得顺带创建文件或目录。
    expect(await fs.readdir(root)).toEqual([]);
  });

  it("★ 内容非法时抛损坏错误,而不是静默返回空对象(Req 2.2)", async () => {
    // 静默返回 {} 的实现会让一次损坏被下一次写入整体覆盖 —— 静默数据丢失。
    await fs.writeFile(join(root, "broken.json"), "{ not json", "utf8");
    const ns = createLocalWorkspaceNamespace(root);
    await expectCode(() => ns.readJson("broken.json"), "corrupt");
  });

  it("★ 合法 JSON 但非对象(数组/标量/null)同样视为损坏", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    for (const [name, text] of [
      ["arr.json", "[1,2]"],
      ["num.json", "42"],
      ["null.json", "null"],
    ] as const) {
      await fs.writeFile(join(root, name), text, "utf8");
      await expectCode(() => ns.readJson(name), "corrupt");
    }
  });

  it("★ 前缀段是值文件时,其下的键即「不存在」——读/存在性/列举三者口径必须一致(Req 2.1)", async () => {
    // 真实路径:list("g") 返回 "g/a.json" 后,调用方把它当分组前缀继续下探。
    // 此时 stat/readFile/readdir 都返回 ENOTDIR;若只有 readJson 把它当 IO 故障抛错,
    // 同一实例就对同一个键给出互斥答案(不存在 vs 故障)。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json", { v: 1 });
    expect(await ns.readJson("g/a.json/x.json")).toEqual({});
    expect(await ns.exists("g/a.json/x.json")).toBe(false);
    expect(await ns.list("g/a.json")).toEqual([]);
  });

  it("★ 非损坏类失败(键指向目录)抛 IO 错误而非损坏错误", async () => {
    // 区分两类错误才有意义:损坏是数据问题(需人工修数据),IO 是环境问题。
    await fs.mkdir(join(root, "adir.json"));
    const ns = createLocalWorkspaceNamespace(root);
    await expectCode(() => ns.readJson("adir.json"), "io");
  });
});

describe("写入与合并(Req 2.3/2.4/2.5)", () => {
  it("缺省合并模式:深度合并并保留未涉及字段(Req 2.3)", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("s.json", { a: { x: 1, y: 2 }, keep: "yes" });
    await ns.writeJson("s.json", { a: { y: 20, z: 30 } });
    expect(await ns.readJson("s.json")).toEqual({
      a: { x: 1, y: 20, z: 30 },
      keep: "yes",
    });
  });

  it("★ 合并模式下数组整体替换,不逐元素合并也不拼接(Req 2.3)", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("arr.json", { list: [1, 2, 3] });
    await ns.writeJson("arr.json", { list: [9] });
    expect(await ns.readJson("arr.json")).toEqual({ list: [9] });
  });

  it("★ merge:false 整体覆盖,使既有值中本次未提供的字段被删除(Req 2.4)", async () => {
    // 对「无论如何都深合并」的实现:gone 会复活,断言失败。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("o.json", { keep: 1, gone: 2 });
    await ns.writeJson("o.json", { keep: 9 }, { merge: false });
    expect(await ns.readJson("o.json")).toEqual({ keep: 9 });
  });

  it("读己之写:写入 resolve 后同实例读回本次值(Req 2.5)", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    for (let i = 0; i < 5; i += 1) {
      await ns.writeJson("rw.json", { i }, { merge: false });
      expect(await ns.readJson("rw.json")).toEqual({ i });
    }
  });

  it("★ 写入自动创建中间目录,键的多段结构落为目录层级", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("sources/acme/settings.json", { on: true });
    expect(
      JSON.parse(await fs.readFile(join(root, "sources/acme/settings.json"), "utf8")),
    ).toEqual({ on: true });
  });
});

describe("列举(Req 2.7)", () => {
  it("★ 只返回直接子级中持有值的键,不递归也不展开分组", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json", { v: 1 });
    await ns.writeJson("g/b.json", { v: 1 });
    await ns.writeJson("g/deep/c.json", { v: 1 }); // 更深层:不返回、也不展开
    await ns.writeJson("other/d.json", { v: 1 }); // 另一前缀:不串
    expect(await ns.list("g")).toEqual(["g/a.json", "g/b.json"]);
  });

  it("★ 按码元序升序:大写 `B` 排在小写 `a` 之前(区域相关排序会反过来)", async () => {
    // 判别性:localeCompare / Intl.Collator 在 en 下给出 [1, a, B],码元序给出 [1, B, a]。
    // ⚠ 刻意**不用** `A.json`+`a.json` 这类仅大小写不同的键对:macOS/Windows 默认文件系统
    // 大小写不敏感,二者会互为同一文件,断言失败的原因将是平台而非排序实现(见
    // local-workspace.ts 头部的「已知平台风险」)。
    const ns = createLocalWorkspaceNamespace(root);
    for (const k of ["s/a.json", "s/B.json", "s/1.json"]) {
      await ns.writeJson(k, { v: 1 });
    }
    expect(await ns.list("s")).toEqual(["s/1.json", "s/B.json", "s/a.json"]);
  });

  it("前缀不存在时返回空数组而不抛", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    expect(await ns.list("nothing/here")).toEqual([]);
  });

  it("列举的前缀同样经键校验", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await expectCode(() => ns.list("../.."), "key");
  });
});

describe("删除与存在性(Req 2.8/2.9)", () => {
  it("★ 删除幂等:删不存在的键成功且不抛,重复删除同样成功", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.delete("never.json");
    await ns.writeJson("d.json", { v: 1 });
    await ns.delete("d.json");
    await ns.delete("d.json");
    expect(await ns.exists("d.json")).toBe(false);
    expect(await ns.readJson("d.json")).toEqual({});
  });

  it("exists 反映存在性(Req 2.9)", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    expect(await ns.exists("e.json")).toBe(false);
    await ns.writeJson("e.json", { v: 1 });
    expect(await ns.exists("e.json")).toBe(true);
    await ns.delete("e.json");
    expect(await ns.exists("e.json")).toBe(false);
  });

  it("★ exists 对目录返回 false:分组不是值", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json", { v: 1 });
    expect(await ns.exists("g")).toBe(false);
  });
});

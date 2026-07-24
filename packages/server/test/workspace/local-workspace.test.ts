import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createLocalWorkspaceNamespace,
  resolveWorkspaceKeyPath,
} from "../../src/workspace/local-workspace.js";
import { DEFAULT_WORKSPACE_MAX_VALUE_BYTES } from "../../src/workspace/limit-config.js";
import type { WorkspaceErrorCode } from "../../src/workspace/types.js";

/**
 * host-contract-ports 任务 4.1/4.2 —— 本地实现的键映射、基本读写与合并
 * (Req 2.1/2.2/2.3/2.4/2.5/2.7/2.8/2.9),以及原子写入、落盘权限、写时上限校验
 * 与「值/分组不可同址」(Req 2.6/3.4/3.5/1.7/1.8)。
 *
 * ⚠ 断言口径:错误一律按稳定判别码 `code` 判定,不用 `instanceof`——与
 * `src/workspace/types.ts` 的跨仓约定一致。
 *
 * 本文件**不覆盖**双根装配与 env 接线(任务 4.3),故只驱动单命名空间工厂。
 */

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), "pi-web-local-ws-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/**
 * 以权限位构造真实环境故障的前提:Windows 无 POSIX 权限位,root 无视权限位 —— 两种环境
 * 下这类场景不可构造,故显式 skip 而非静默通过(否则是假绿)。
 */
const permsEnforced = process.platform !== "win32" && process.getuid?.() !== 0;

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

  it.skipIf(!permsEnforced)(
    "★ 非损坏类失败(不可读的既有值)抛 IO 错误而非损坏错误",
    async () => {
      // 区分两类错误才有意义:损坏是数据问题(需人工修数据),IO 是环境问题。
      // 对「把任何 readFile 失败都当损坏」的实现:此处会得到 corrupt,断言失败。
      await fs.writeFile(join(root, "locked.json"), '{"v":1}', "utf8");
      await fs.chmod(join(root, "locked.json"), 0o000);
      const ns = createLocalWorkspaceNamespace(root);
      await expectCode(() => ns.readJson("locked.json"), "io");
      await fs.chmod(join(root, "locked.json"), 0o600); // 便于 afterEach 清理
    },
  );
});

describe("值与分组不可同址(Req 1.7/1.8,契约 §3.2 第 6 条)", () => {
  it("★ 正向:既有值键的严格前缀之下不得写入,抛键非法错误且说明与哪个键冲突(Req 1.7)", async () => {
    // 对「直接 mkdir -p + writeFile」的实现:mkdir 会得到 ENOTDIR/EEXIST 并被包成 IO 错误,
    // 判别码断言即失败 —— 而扁平 KV 后端根本不会失败。两端对齐正是本条的存在理由。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json", { v: 1 });

    let caught: unknown;
    try {
      await ns.writeJson("g/a.json/x.json", { v: 2 });
    } catch (err) {
      caught = err;
    }
    expect(codeOf(caught)).toBe("key");
    expect((caught as { reason?: string }).reason).toContain("g/a.json");
    // 冲突写入不得留下任何痕迹(尤其不得先把 g/a.json 变成目录或另建中间目录)。
    expect(await fs.readdir(join(root, "g"))).toEqual(["a.json"]);
    expect(await ns.readJson("g/a.json")).toEqual({ v: 1 });
  });

  it("★ 反向:某既有值键的严格前缀本身不得被写为值,抛键非法错误并指出冲突键(Req 1.7)", async () => {
    // 层级 FS 上 rename 到目录会自然失败(EISDIR/ENOTEMPTY);若放任该 IO 错误冒出,
    // 与扁平 KV 后端(那里两者能并存)的行为就对不齐 —— 勘误⑧ 要消灭的正是这种状态。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json/x.json", { v: 1 });

    let caught: unknown;
    try {
      await ns.writeJson("g/a.json", { v: 2 });
    } catch (err) {
      caught = err;
    }
    expect(codeOf(caught)).toBe("key");
    expect((caught as { reason?: string }).reason).toContain("g/a.json/x.json");
    // 既有值不得被破坏。
    expect(await ns.readJson("g/a.json/x.json")).toEqual({ v: 1 });
  });

  it("★ 空分组不是冲突:值被删后可在原分组位置写入值键(契约 §3.5)", async () => {
    // `delete` 只删值、不删父目录,故层级载体上残留一个**空目录** `g/a.json`。
    // 它不含任何值键,据契约 §3.2 第 6 条不构成同址冲突;扁平 KV 后端上分组随最后一个值
    // 消失,同一序列必然成功。若这里拒绝,就是本契约要消灭的那类两端分歧(勘误⑧)。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json/x.json", { v: 1 });
    await ns.delete("g/a.json/x.json");

    await ns.writeJson("g/a.json", { v: 2 });
    expect(await ns.readJson("g/a.json")).toEqual({ v: 2 });
    expect(await ns.exists("g/a.json")).toBe(true);
    expect(await ns.list("g")).toEqual(["g/a.json"]);
  });

  it("★ 更深的残留空目录链同样不构成冲突", async () => {
    // `g/a.json/p/q/` 全空 ⇒ 该位置一个值键都没有 ⇒ 写 `g/a.json` 必须成功。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json/p/q/deep.json", { v: 1 });
    await ns.delete("g/a.json/p/q/deep.json");
    await ns.writeJson("g/a.json", { v: 2 });
    expect(await ns.readJson("g/a.json")).toEqual({ v: 2 });
  });

  it("★ 但只要分组下还剩一个值键,同址写入仍必须被拒", async () => {
    // 与上一例的判别对照:证明「允许空分组」没有把 Req 1.7 整条放水掉。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json/x.json", { v: 1 });
    await ns.writeJson("g/a.json/y.json", { v: 1 });
    await ns.delete("g/a.json/x.json"); // 还剩 y.json
    await expectCode(() => ns.writeJson("g/a.json", { v: 2 }), "key");
    expect(await ns.readJson("g/a.json/y.json")).toEqual({ v: 1 });
  });

  it("★ 深层值键同样构成冲突,且绝不能被「清理空分组」顺手删掉", async () => {
    // 判别性:只看直接子级来判定「分组是否为空」的实现,会认为 g/a.json 是空的 →
    // 清理掉整棵树 → 静默删除 g/a.json/p/q/deep.json。那是数据丢失,不是行为差异。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json/p/q/deep.json", { v: 1 });

    let caught: unknown;
    try {
      await ns.writeJson("g/a.json", { v: 2 });
    } catch (err) {
      caught = err;
    }
    expect(codeOf(caught)).toBe("key");
    expect((caught as { reason?: string }).reason).toContain("g/a.json/p/q/deep.json");
    expect(await ns.readJson("g/a.json/p/q/deep.json")).toEqual({ v: 1 });
  });

  it.skipIf(!permsEnforced)(
    "★ 清理残留空分组因环境原因失败时,抛 IO 错误而非键非法错误",
    async () => {
      // 父目录不可写 ⇒ `rmdir` 以 EACCES 失败。这是**环境故障**,不是宿主把键写错了:
      // 判成 key 会让调用方去改键(键是对的,改不好),而 io 才指向真正的处置(修权限)。
      //
      // 判别性:把清理失败/errno 直接映射成 key 的实现(第 1 轮的写法)在此给出 key。
      // 正确实现必须先重新探测「是否真存在冲突值键」——这里一个都没有 ⇒ io。
      const ns = createLocalWorkspaceNamespace(root);
      await ns.writeJson("g/a.json/x.json", { v: 1 });
      await ns.delete("g/a.json/x.json"); // 残留空目录 g/a.json

      await fs.chmod(join(root, "g"), 0o500); // 可读可进入,不可写 ⇒ 删不掉其中的目录项
      try {
        await expectCode(() => ns.writeJson("g/a.json", { v: 2 }), "io");
      } finally {
        // 必须恢复,否则 afterEach 的临时根清理会失败并污染后续用例。
        await fs.chmod(join(root, "g"), 0o700);
      }
    },
  );

  it("残留空目录不出现在 list 结果里(分组不是值,与 KV 后端一致)", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json/x.json", { v: 1 });
    await ns.delete("g/a.json/x.json");
    expect(await ns.list("g")).toEqual([]);
    expect(await ns.exists("g/a.json")).toBe(false);
    expect(await ns.readJson("g/a.json")).toEqual({});
  });

  it("★ 读一个只是分组前缀的键返回空对象,不抛 IO 错误(Req 1.8)", async () => {
    // 规则保证分组永不是值键 ⇒ 它就是个不存在的键 ⇒ 按 Req 2.1 读为 {}。
    // 对「readFile 遇 EISDIR 就抛 IO」的实现(4.1 的形态):此处会得到 io,断言失败。
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json", { v: 1 });
    expect(await ns.readJson("g")).toEqual({});
    // 与 exists/list 的口径保持一致:同一个键不得给出互斥答案。
    expect(await ns.exists("g")).toBe(false);
    expect(await ns.list("g")).toEqual(["g/a.json"]);
  });

  it("★ 删除一个只是分组前缀的键幂等成功,且不删掉其下的值(Req 2.8 + 1.8)", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("g/a.json", { v: 1 });
    await ns.delete("g"); // 不存在的键 → 幂等成功
    expect(await ns.readJson("g/a.json")).toEqual({ v: 1 });
  });
});

describe("原子写入(Req 2.6)", () => {
  it("★ 写入是整体替换而非原地改写:写入前已打开的读者仍读到完整旧值", async () => {
    // 判别性:`fs.writeFile(path, ...)` 就地截断重写时,写入前打开的 fd 会跟着看到
    // 新内容/半截内容;temp + rename 则把旧 inode 完整留给已有读者。这正是「读取方
    // 绝不观察到部分写入」在真实文件系统上的机制,恒真断言(写完能读到完整值)测不到它。
    const ns = createLocalWorkspaceNamespace(root);
    const path = resolveWorkspaceKeyPath(root, "atomic.json");
    const before = { v: "old", pad: "x".repeat(4096) };
    const after = { v: "new", pad: "y".repeat(200_000) }; // 足够大,就地写必被截断观察到
    await ns.writeJson("atomic.json", before, { merge: false });
    const inoBefore = (await fs.stat(path)).ino;

    const reader = await fs.open(path, "r");
    try {
      await ns.writeJson("atomic.json", after, { merge: false });
      const seen = await reader.readFile("utf8");
      expect(JSON.parse(seen)).toEqual(before);
    } finally {
      await reader.close();
    }
    // 佐证:目标路径被换成了新 inode(替换语义),而非原地改写。
    expect((await fs.stat(path)).ino).not.toBe(inoBefore);
    expect(await ns.readJson("atomic.json")).toEqual(after);
  });

  it("成功写入后不残留临时文件", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await ns.writeJson("a.json", { v: 1 });
    await ns.writeJson("a.json", { v: 2 });
    expect(await fs.readdir(root)).toEqual(["a.json"]);
  });
});

describe("落盘权限(与既有 ConfigCodec 一致)", () => {
  // POSIX 权限位在 Windows 上无意义:显式 skip,不让断言在那里变成噪音或假绿。
  it.skipIf(process.platform === "win32")(
    "★ 目录 0700(含递归创建的中间目录)、文件 0600",
    async () => {
      const ns = createLocalWorkspaceNamespace(root);
      await ns.writeJson("sources/acme/settings.json", { on: true });
      expect((await fs.stat(join(root, "sources"))).mode & 0o777).toBe(0o700);
      expect((await fs.stat(join(root, "sources", "acme"))).mode & 0o777).toBe(0o700);
      expect(
        (await fs.stat(join(root, "sources", "acme", "settings.json"))).mode & 0o777,
      ).toBe(0o600);
    },
  );
});

describe("单键值上限(Req 3.4/3.5)", () => {
  /** 序列化后必然超过 `limit` 字节的值。 */
  function oversized(limit: number): Record<string, unknown> {
    return { blob: "z".repeat(limit + 64) };
  }

  it("★ 写入超限抛超限错误,且不写入任何内容(Req 3.4)", async () => {
    const ns = createLocalWorkspaceNamespace(root, { maxValueBytes: 512 });
    await expectCode(() => ns.writeJson("big.json", oversized(512)), "limit");
    expect(await ns.exists("big.json")).toBe(false);
    expect(await fs.readdir(root)).toEqual([]); // 连临时文件都不得留下
  });

  it("★ 合并后的整值参与校验:两次各自合规的写入合起来超限即被拒", async () => {
    // 对「只量本次入参」的实现:第二次写入会通过,断言失败。
    const ns = createLocalWorkspaceNamespace(root, { maxValueBytes: 512 });
    await ns.writeJson("m.json", { a: "a".repeat(300) });
    await expectCode(() => ns.writeJson("m.json", { b: "b".repeat(300) }), "limit");
    expect(await ns.readJson("m.json")).toEqual({ a: "a".repeat(300) });
  });

  it("★ 既有值大于当前上限时读取仍完整返回(Req 3.5)", async () => {
    // 若读路径也校验上限,调小上限会使既有数据不可达 —— 用户还无法自救(要缩小它必须先读到它)。
    const value = oversized(512);
    const big = createLocalWorkspaceNamespace(root, {
      maxValueBytes: 64 * 1024,
    });
    await big.writeJson("legacy.json", value, { merge: false });

    const shrunk = createLocalWorkspaceNamespace(root, { maxValueBytes: 512 });
    expect(await shrunk.readJson("legacy.json")).toEqual(value);
    // 佐证小上限确实生效:同一实例上再写同尺寸的值必须被拒。
    await expectCode(
      () => shrunk.writeJson("legacy.json", value, { merge: false }),
      "limit",
    );
  });

  it("未指定上限时采用契约默认值 1 MiB", async () => {
    const ns = createLocalWorkspaceNamespace(root);
    await expectCode(
      () => ns.writeJson("huge.json", oversized(DEFAULT_WORKSPACE_MAX_VALUE_BYTES)),
      "limit",
    );
    // 略小于默认上限的值必须写得进去 —— 否则「默认 1 MiB」只是个拒绝一切的摆设。
    const justUnder = {
      blob: "z".repeat(DEFAULT_WORKSPACE_MAX_VALUE_BYTES - 1024),
    };
    await ns.writeJson("ok.json", justUnder, { merge: false });
    expect(await ns.readJson("ok.json")).toEqual(justUnder);
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

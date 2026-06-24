/**
 * completion-provider-framework 单元测试。
 * 覆盖:合并/优先级/去重/截断、触发符归一、token 文法、注册表(并集/超时/同符多 provider)、
 * 提交期 resolve(缺省/失败保留)、file provider(枚举/gitignore/缓存/模糊/截断)、
 * 安全(realpath 越界拒绝 + symlink 不跟随)、可扩展性(加 provider 即生效)。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  createCompletionRegistry,
  createFileProvider,
  mergeCompletions,
  normalizeTrigger,
  parseTokens,
  resolveCompletions,
  serializeToken,
  type CompletionProvider,
  type CompletionCtx,
} from "../../src/completion/index.js";
import type { CompletionItem } from "@blksails/protocol";

function item(p: Partial<CompletionItem> & { id: string }): CompletionItem {
  return {
    providerId: p.providerId ?? "x",
    kind: p.kind ?? "x",
    id: p.id,
    label: p.label ?? p.id,
    ...(p.score !== undefined ? { score: p.score } : {}),
  };
}
function prov(p: Partial<CompletionProvider> & { id: string }): CompletionProvider {
  return {
    id: p.id,
    trigger: p.trigger ?? "@",
    ...(p.kind !== undefined ? { kind: p.kind } : {}),
    ...(p.priority !== undefined ? { priority: p.priority } : {}),
    complete: p.complete ?? (async () => []),
    ...(p.resolve !== undefined ? { resolve: p.resolve } : {}),
  };
}
const CTX: CompletionCtx = { sessionId: "s1", cwd: "/tmp", userId: "u1" };

describe("normalizeTrigger", () => {
  it("全角规约为规范符,未知原样", () => {
    expect(normalizeTrigger("＠")).toBe("@");
    expect(normalizeTrigger("￥")).toBe("$");
    expect(normalizeTrigger("／")).toBe("/");
    expect(normalizeTrigger("@")).toBe("@");
    expect(normalizeTrigger("%")).toBe("%");
  });
});

describe("token 文法", () => {
  it("序列化与解析往返;裸 @word 不当 token", () => {
    expect(serializeToken({ trigger: "@", kind: "file", id: "src/a.ts" })).toBe(
      "@file:src/a.ts",
    );
    const refs = parseTokens("看 @file:src/a.ts 和 @someone 还有 @user:u_1");
    expect(refs.map((r) => `${r.kind}:${r.id}`)).toEqual([
      "file:src/a.ts",
      "user:u_1",
    ]);
    expect(parseTokens("no tokens here")).toEqual([]);
  });
});

describe("mergeCompletions", () => {
  it("按 (priority, score, label) 排序", () => {
    const res = mergeCompletions(
      [
        { provider: prov({ id: "a", priority: 1 }), items: [item({ id: "a1", score: 1 })] },
        { provider: prov({ id: "b", priority: 5 }), items: [item({ id: "b1", score: 0 })] },
      ],
      { limit: 10 },
    );
    expect(res.items[0]?.id).toBe("b1"); // 高 priority 先
  });
  it("同 kind:id 去重保高优", () => {
    const res = mergeCompletions(
      [
        { provider: prov({ id: "a", priority: 1 }), items: [item({ kind: "file", id: "dup", label: "low" })] },
        { provider: prov({ id: "b", priority: 9 }), items: [item({ kind: "file", id: "dup", label: "high" })] },
      ],
      { limit: 10 },
    );
    expect(res.items).toHaveLength(1);
    expect(res.items[0]?.label).toBe("high");
  });
  it("limit 截断 + 分组计数", () => {
    const res = mergeCompletions(
      [
        {
          provider: prov({ id: "a", kind: "file" }),
          items: [item({ kind: "file", id: "1" }), item({ kind: "file", id: "2" }), item({ kind: "file", id: "3" })],
        },
      ],
      { limit: 2 },
    );
    expect(res.items).toHaveLength(2);
    expect(res.groups).toEqual([{ kind: "file", count: 2 }]);
  });
  it("空输入返回空", () => {
    expect(mergeCompletions([], { limit: 5 })).toEqual({ items: [], groups: [] });
  });
});

describe("registry", () => {
  it("触发符并集 + 单字符校验 + 同 id 覆盖告警", () => {
    const warns: string[] = [];
    const reg = createCompletionRegistry({ onWarn: (m) => warns.push(m) });
    reg.register(prov({ id: "file", trigger: "@" }));
    reg.register(prov({ id: "env", trigger: "$" }));
    reg.register(prov({ id: "file", trigger: "@" })); // 覆盖
    expect(warns.length).toBe(1);
    const triggers = reg.triggers().map((t) => t.trigger).sort();
    expect(triggers).toEqual(["$", "@"]);
    expect(() => reg.register(prov({ id: "bad", trigger: "@@" }))).toThrow();
  });

  it("同符多 provider 并发 + 按优先级合并", async () => {
    const reg = createCompletionRegistry();
    reg.register(
      prov({
        id: "users",
        trigger: "@",
        kind: "user",
        priority: 1,
        complete: async () => [item({ providerId: "users", kind: "user", id: "alice", score: 1 })],
      }),
    );
    reg.register(
      prov({
        id: "files",
        trigger: "@",
        kind: "file",
        priority: 5,
        complete: async () => [item({ providerId: "files", kind: "file", id: "a.ts", score: 1 })],
      }),
    );
    const res = await reg.query("@", "a", CTX);
    expect(res.items[0]?.kind).toBe("file"); // priority 5 先
    expect(res.groups.map((g) => g.kind)).toContain("user");
  });

  it("慢/抛错 provider 超时降级,不阻塞其余", async () => {
    const reg = createCompletionRegistry({ providerTimeoutMs: 50 });
    reg.register(
      prov({
        id: "slow",
        trigger: "@",
        kind: "slow",
        complete: () => new Promise(() => {}), // 永不 resolve
      }),
    );
    reg.register(
      prov({
        id: "fast",
        trigger: "@",
        kind: "fast",
        complete: async () => [item({ kind: "fast", id: "ok" })],
      }),
    );
    const res = await reg.query("@", "x", CTX);
    expect(res.items.map((i) => i.kind)).toEqual(["fast"]);
  });

  it("未知触发符返回空集不抛", async () => {
    const reg = createCompletionRegistry();
    reg.register(prov({ id: "file", trigger: "@" }));
    expect(await reg.query("%", "x", CTX)).toEqual({ items: [], groups: [] });
  });

  it("可扩展性:加 provider 即在 query 生效(零端点改动)", async () => {
    const reg = createCompletionRegistry();
    reg.register(
      prov({
        id: "env",
        trigger: "$",
        kind: "env",
        complete: async () => [item({ kind: "env", id: "HOME", label: "$HOME" })],
      }),
    );
    const res = await reg.query("$", "HO", CTX);
    expect(res.items[0]?.id).toBe("HOME");
  });
});

describe("resolveCompletions", () => {
  const reg = createCompletionRegistry();
  reg.register(
    prov({
      id: "file",
      trigger: "@",
      kind: "file",
      resolve: async (ref) => ({ text: `@${ref.id}` }),
    }),
  );
  reg.register(prov({ id: "noresolve", trigger: "#", kind: "tag" })); // 无 resolve

  it("file token 规约为 @path", async () => {
    expect(await resolveCompletions("see @file:src/a.ts", CTX, reg)).toBe("see @src/a.ts");
  });
  it("无 token 原样返回", async () => {
    expect(await resolveCompletions("plain message", CTX, reg)).toBe("plain message");
  });
  it("无 resolve 的 provider token 保留原文本", async () => {
    expect(await resolveCompletions("tag @tag:x done", CTX, reg)).toBe("tag @tag:x done");
  });
  it("前缀 token 不互相污染(位置式重写)", async () => {
    // @file:a 是 @file:a.ts 的前缀;全局 split 会误伤,位置式重写不会。
    expect(await resolveCompletions("@file:a.ts 与 @file:a", CTX, reg)).toBe(
      "@a.ts 与 @a",
    );
  });
  it("resolve 抛错保留原文本", async () => {
    const r2 = createCompletionRegistry();
    r2.register(
      prov({
        id: "file",
        trigger: "@",
        kind: "file",
        resolve: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(await resolveCompletions("x @file:a.ts", CTX, r2)).toBe("x @file:a.ts");
  });
});

describe("file provider", () => {
  let dir: string;
  let outside: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cpf-cwd-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "cpf-out-"));
    await fs.writeFile(path.join(outside, "secret.txt"), "SECRET");
    await fs.mkdir(path.join(dir, "src"));
    await fs.writeFile(path.join(dir, "src", "app.ts"), "x");
    await fs.writeFile(path.join(dir, "src", "util.ts"), "x");
    await fs.writeFile(path.join(dir, "README.md"), "x");
    await fs.writeFile(path.join(dir, ".gitignore"), "ignored.log\nbuildout/\n");
    await fs.writeFile(path.join(dir, "ignored.log"), "x");
    await fs.mkdir(path.join(dir, "buildout"));
    await fs.writeFile(path.join(dir, "buildout", "x.js"), "x");
    await fs.mkdir(path.join(dir, "node_modules"));
    await fs.writeFile(path.join(dir, "node_modules", "dep.js"), "x");
    // symlink 逃逸:dir/link → outside
    try {
      await fs.symlink(outside, path.join(dir, "link"), "dir");
    } catch {
      /* 某些平台无权建 symlink;相关断言会自然跳过 */
    }
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  function ctx(): CompletionCtx {
    return { sessionId: "s", cwd: dir, userId: "u" };
  }

  it("枚举 cwd 文件,尊重 .gitignore、跳过 node_modules、不跟随 symlink", async () => {
    const fp = createFileProvider();
    const items = await fp.complete({ query: "", ctx: ctx() });
    const ids = items.map((i) => i.id);
    expect(ids).toContain("src/app.ts");
    expect(ids).toContain("README.md");
    expect(ids).not.toContain("ignored.log"); // .gitignore
    expect(ids.some((p) => p.startsWith("buildout/"))).toBe(false); // .gitignore dir
    expect(ids.some((p) => p.startsWith("node_modules/"))).toBe(false); // 重目录
    expect(ids.some((p) => p.startsWith("link/"))).toBe(false); // symlink 不跟随
  });

  it("模糊匹配收敛 + 候选带 @file: token", async () => {
    const fp = createFileProvider();
    const items = await fp.complete({ query: "app", ctx: ctx() });
    expect(items[0]?.id).toBe("src/app.ts");
    expect(items[0]?.insertText).toBe("@file:src/app.ts");
  });

  it("超遍历上限截断并标示", async () => {
    const fp = createFileProvider({ walkCap: 1 });
    const items = await fp.complete({ query: "", ctx: ctx() });
    expect(items.some((i) => i.id === "__truncated__")).toBe(true);
  });

  it("缓存:TTL 内复用(改时钟前不重walk)", async () => {
    let t = 1000;
    const fp = createFileProvider({ now: () => t });
    const a = await fp.complete({ query: "", ctx: ctx() });
    await fs.writeFile(path.join(dir, "NEW.txt"), "x");
    const b = await fp.complete({ query: "", ctx: ctx() }); // 同 TTL 窗口
    expect(b.map((i) => i.id)).toEqual(a.map((i) => i.id)); // 命中缓存,看不到 NEW.txt
    t += 10000; // 过期
    const c = await fp.complete({ query: "", ctx: ctx() });
    expect(c.map((i) => i.id)).toContain("NEW.txt");
    await fs.rm(path.join(dir, "NEW.txt"), { force: true });
  });

  it("resolve:合法路径 → @rel", async () => {
    const fp = createFileProvider();
    const r = await fp.resolve!({ kind: "file", id: "src/app.ts", raw: "@file:src/app.ts" }, ctx());
    expect(r).toEqual({ text: "@src/app.ts" });
  });

  it("安全:../ 越界路径被 resolve 拒绝(null)", async () => {
    const fp = createFileProvider();
    const r = await fp.resolve!(
      { kind: "file", id: "../" + path.basename(outside) + "/secret.txt", raw: "x" },
      ctx(),
    );
    expect(r).toBeNull();
  });

  it("安全:不存在路径被拒绝(null)", async () => {
    const fp = createFileProvider();
    const r = await fp.resolve!({ kind: "file", id: "nope/missing.ts", raw: "x" }, ctx());
    expect(r).toBeNull();
  });
});

import { compileGlobs } from "../../src/completion/glob.js";

describe("compileGlobs", () => {
  it("**/*.ts 跨层匹配 ts;不匹配非 ts", () => {
    const m = compileGlobs(["**/*.ts"])!;
    expect(m("app.ts")).toBe(true);
    expect(m("src/a/b.ts")).toBe(true);
    expect(m("README.md")).toBe(false);
  });
  it("src/** 仅匹配 src 下", () => {
    const m = compileGlobs(["src/**"])!;
    expect(m("src/app.ts")).toBe(true);
    expect(m("src/a/b.ts")).toBe(true);
    expect(m("lib/app.ts")).toBe(false);
  });
  it("顶层 *.json 不跨目录", () => {
    const m = compileGlobs(["*.json"])!;
    expect(m("package.json")).toBe(true);
    expect(m("packages/x/package.json")).toBe(false);
  });
  it("{a,b} 分支", () => {
    const m = compileGlobs(["{src,lib}/**/*.ts"])!;
    expect(m("src/a.ts")).toBe(true);
    expect(m("lib/a.ts")).toBe(true);
    expect(m("test/a.ts")).toBe(false);
  });
  it("空/未定义 → null", () => {
    expect(compileGlobs(undefined)).toBeNull();
    expect(compileGlobs([])).toBeNull();
  });
});

describe("file provider 选项(includes/excludes/respectGitignore/override)", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "cpf-opt-"));
    await fs.writeFile(path.join(dir, "a.ts"), "x");
    await fs.writeFile(path.join(dir, "a.test.ts"), "x");
    await fs.writeFile(path.join(dir, "b.md"), "x");
    await fs.mkdir(path.join(dir, "sub"));
    await fs.writeFile(path.join(dir, "sub", "c.ts"), "x");
    await fs.writeFile(path.join(dir, ".gitignore"), "ign.ts\n");
    await fs.writeFile(path.join(dir, "ign.ts"), "x");
  });
  afterAll(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const ctx = (): CompletionCtx => ({ sessionId: "s", cwd: dir, userId: "u" });
  const ids = async (fp: ReturnType<typeof createFileProvider>): Promise<string[]> =>
    (await fp.complete({ query: "", ctx: ctx() })).map((i) => i.id);

  it("includes 仅 ts + excludes 剔除 test", async () => {
    const fp = createFileProvider({
      includes: ["**/*.ts"],
      excludes: ["**/*.test.ts"],
    });
    const got = await ids(fp);
    expect(got).toContain("a.ts");
    expect(got).toContain("sub/c.ts");
    expect(got).not.toContain("a.test.ts");
    expect(got).not.toContain("b.md");
  });

  it("excludes 胜 includes", async () => {
    const fp = createFileProvider({ includes: ["**/*.ts"], excludes: ["a.ts"] });
    const got = await ids(fp);
    expect(got).not.toContain("a.ts");
    expect(got).toContain("sub/c.ts");
  });

  it("respectGitignore=false 放行被忽略文件", async () => {
    const on = await ids(createFileProvider({ includes: ["**/*.ts"] }));
    expect(on).not.toContain("ign.ts");
    const off = await ids(
      createFileProvider({ includes: ["**/*.ts"], respectGitignore: false }),
    );
    expect(off).toContain("ign.ts");
  });

  it("id/trigger/kind 覆盖 → 候选带新 kind 与 token", async () => {
    const fp = createFileProvider({
      id: "docs",
      trigger: "#",
      kind: "docs",
      includes: ["**/*.md"],
    });
    expect(fp.trigger).toBe("#");
    const items = await fp.complete({ query: "", ctx: ctx() });
    expect(items.every((i) => i.kind === "docs")).toBe(true);
    expect(items.find((i) => i.id === "b.md")?.insertText).toBe("#docs:b.md");
  });
});

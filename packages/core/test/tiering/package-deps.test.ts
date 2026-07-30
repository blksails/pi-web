import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FORBIDDEN_PACKAGE_DEPS,
  PEER_ONLY_DEPS,
  auditPackageDeps,
  type DepViolation,
  type PackageManifest,
} from "./package-deps.js";
import { PACKAGE_ROOTS, type PackageRoot } from "./package-roots.js";

/**
 * 包依赖守卫(spec: core-package-extraction R1.2/R1.3/R1.4;
 * runner-package-extraction 任务 2.4 推广到多包根)。
 *
 * 断言各包的**声明层**不含云沙箱 SDK / 数据库驱动 / MCP SDK / HTTP 框架 / 包注册表客户端,
 * 且 agent 运行时 SDK 只以 peer 出现。这条判据是拆包唯一**机械可校验**的价值证明:
 * 「它没有偷偷拖进云厂商 SDK」是可验证的事实,而不是一句承诺。
 *
 * ★ 本文件原先**硬编码只查 core**(`PACKAGE_ROOTS.find((r) => r.name === "core")`)。
 *   新包成立后那等于「新包的依赖面根本没被审,而用例照样全绿」—— 又一例
 *   「没装上的守卫报出的绿」。现改为**每个包根各自声明策略**,见 `PACKAGE_DEP_POLICIES`。
 */

/** 被禁项按名索引 —— `why` 只有一个事实源,各包根的规则只引名字。 */
const FORBIDDEN_BY_NAME = new Map(FORBIDDEN_PACKAGE_DEPS.map((f) => [f.name, f] as const));

/**
 * 一个包根的依赖策略。
 *
 * ★ 为什么不能对所有包根执行同一套禁令:同一份禁令表要对不同包根给出**相反**的答案。
 *   `core` / `runner` 禁云沙箱 SDK / 数据库驱动 / MCP SDK;**adapters 允许**它们 ——
 *   那正是它存在的理由(spec adapters-package-extraction R1.2:本仓中三者**只应**出现在此处);
 *   兼容层 `packages/server` 则由「允许」翻成**禁止**(R2.4 的守卫化,见 design C2)。
 *   一刀切会逼人去放宽禁令清单本身,那才是真正的倒退。故按包根区分 ——
 *   但必须是**显式声明**,不是「查得到就查、查不到就放行」。
 */
type DepPolicy =
  | {
      readonly kind: "audited";
      /** 该包禁止声明的依赖名,必须是 {@link FORBIDDEN_PACKAGE_DEPS} 的子集(见同名断言)。 */
      readonly forbidden: readonly string[];
      /** 必须出现在 `peerDependencies`、且不得出现在 deps/devDeps 的依赖。 */
      readonly peerOnly: readonly string[];
      /**
       * **禁令已定但此刻尚未生效**的依赖:它们此刻**必须仍然**出现在本包的
       * deps/devDeps 里,清理干净的那一刻本标记即过期报红。
       *
       * ★ 语义与 `package-roots.ts` 的 `pendingContributions` 同构,理由也同构:
       *   R2.4 要求「兼容层重新引入三者即失败」,而三者要到任务 5.2 才移得掉 ——
       *   守卫必须先装上,于是过渡期里判据被**翻转**而不是被关掉:
       *   标记在时"必须仍然违规",标记不在时"必须不违规",
       *   **没有一刻是无人看管的**,也没有留下需要后人回来打开的开关 ——
       *   标记只能通过让守卫变红来退场(见「pendingRemoval 标记未过期」一条)。
       *
       * ★ 它**不是**「豁免这个名字」:一个不在本表里的被禁项(如兼容层的 `hono`)
       *   照样当场报红并指出依赖名与所在字段,所以禁令此刻是**活的**,不是空转。
       */
      readonly pendingRemoval?: readonly { readonly name: string; readonly why: string }[];
      /**
       * 是否同时执行 R1.3 的**源码侧**判据(src 里对 agent SDK 只有 `import type`)。
       *
       * ★ 只对 core 成立,不是疏漏:core 走**源码直连**分发且 SDK 是 *optional* peer,
       *   一个值导入就会让没装 SDK 的消费方 `tsc` 直接失败。runner 的 SDK 是
       *   **非 optional** peer(design C1:缺它必然运行时失败,标"可选"是一句谎),
       *   它本来就要值导入 SDK 去跑 agent —— 对它套这条判据是错的,会在任务 3.1 搬入实现时误报。
       */
      readonly srcTypeOnlyAgentSdk: boolean;
    }
  | {
      readonly kind: "exempt";
      /** 豁免必须写明理由 —— 空理由的豁免与「忘了定规则」无法区分。 */
      readonly why: string;
    };

/**
 * 包根 → 依赖策略。**每个 {@link PACKAGE_ROOTS} 条目都必须在此有一项**,
 * 漏定即由「策略表与包根名册逐项对应」一条响亮失败,而不是默默按最宽松处理。
 */
const PACKAGE_DEP_POLICIES: Readonly<Record<string, DepPolicy>> = {
  core: {
    kind: "audited",
    forbidden: FORBIDDEN_PACKAGE_DEPS.map((f) => f.name),
    // 内核只要 pi-coding-agent 一个 peer(且是 optional);它不引用 pi-ai。
    peerOnly: ["@earendil-works/pi-coding-agent"],
    srcTypeOnlyAgentSdk: true,
  },
  runner: {
    // spec runner-package-extraction R1.2 / design C1:云沙箱 SDK、数据库驱动、
    // WebSocket 实现、MCP SDK 四类在 runner 目录里零引用,却随旧包被沙箱镜像装下。
    kind: "audited",
    forbidden: ["e2b", "pg", "ws", "@modelcontextprotocol/sdk"],
    peerOnly: ["@earendil-works/pi-coding-agent"],
    srcTypeOnlyAgentSdk: false,
  },
  adapters: {
    // spec adapters-package-extraction R1.2 / design C1:三个重依赖(e2b / pg / MCP SDK)
    // **归此包**,故它们对本包**合法**,不在 forbidden 里 —— 这是本包存在的理由。
    // 仍然被禁的是不属本包职责的那些:
    kind: "audited",
    forbidden: [
      // HTTP 框架:adapters 绑定的是外部系统的**出向**客户端,不承载入向 HTTP
      // (本仓 hono 只出现在仓库根的 `server/index.ts`,不在任何 packages/* 里)。
      "hono",
      // 包注册表客户端:design C1 的 Allowed Dependencies 逐项列出了本包允许的依赖
      // (core / logger / protocol / zod + e2b / pg / MCP SDK),注册表客户端不在其中;
      // 实测 12 个待搬模块对它零引用。
      "@pi-clouds/registry-client",
      "@blksails/registry-client",
    ],
    // ★ `ws` **刻意不禁**:`sandbox-transport/sandbox-ws-transport.ts:218` 有
    //   `await import("ws")`,该模块正是任务 3.1 要搬进本包的。禁了它会在 3.1 变成一条
    //   **误报**,而误报会教人去放宽判据 —— 那比没有这条禁令更糟。
    //   (兼容层现声明了 `ws` 但已无引用,其去留不在本 spec 的 R2 范围内,故两边都不动。)
    peerOnly: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"],
    // 本包对 agent SDK 有 7 处**值**导入(任务 1.1),peer 也刻意不标 optional ——
    // 对它套「源码仅类型引用」是错的,会在 3.1 搬入实现时误报(同 runner)。
    srcTypeOnlyAgentSdk: false,
  },
  server: {
    // ★ 由 exempt 翻成 audited:这是 R2.4 / design C2 的守卫化 ——
    //   「兼容层重新引入三者即失败」必须是一条**活的**机械判据,
    //   而 exempt 意味着兼容层的依赖面完全无人看管(上一轮它就是这个状态)。
    kind: "audited",
    forbidden: ["hono", "e2b", "pg", "@modelcontextprotocol/sdk"],
    // ★ 三者此刻**仍在** `dependencies` 里,要到任务 5.2 才移除(5.2 依赖 5.1、5.1 依赖搬迁)。
    //   故用 pendingRemoval 把判据**翻转**为「此刻必须仍然违规」,而不是把禁令关掉:
    //   5.2 一落地,「标记未过期」一条立刻报红要求删标记,禁令随之自动生效。
    pendingRemoval: [
      {
        name: "e2b",
        why: "云沙箱 SDK 由任务 5.2 从兼容层 dependencies 移除(实现要先在 3.1 搬进 adapters 包)",
      },
      {
        name: "pg",
        why: "数据库驱动由任务 5.2 从兼容层 dependencies 移除(实现要先在 3.1 搬进 adapters 包)",
      },
      {
        name: "@modelcontextprotocol/sdk",
        why: "MCP SDK 由任务 5.2 从兼容层 dependencies 移除;⚠ 闭包层预期仍经 tool-kit 传递引入(design C2),本判据只管**自身声明**",
      },
    ],
    // ★ 兼容层是**装配层**,它硬依赖 agent 运行时 SDK 属其职责(它就是那个把 agent 跑起来的包),
    //   故这里刻意为空 —— peer-only 判据只对**被消费的库包**(core / runner / adapters)成立。
    //   空集不会让本包静默失守:上面的 forbidden 有 4 项且 `hono` 此刻是活的。
    peerOnly: [],
    srcTypeOnlyAgentSdk: false,
  },
};

function manifestOf(dir: string): PackageManifest {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageManifest;
}

/** 与 `package-deps.ts` 内部同义的前缀匹配:`x` 命中 `x` 与 `x/...`。 */
function matchesName(declared: string, ruleName: string): boolean {
  return declared === ruleName || declared.startsWith(`${ruleName}/`);
}

/**
 * 按某个包根的策略审计一份 manifest。
 *
 * 实现方式是「全量审计 + 按本包规则筛选」:`auditPackageDeps` 仍是唯一判据实现,
 * 策略表只决定**哪些规则对本包生效**。前提是策略里的名字必须都在全量清单里 ——
 * 否则筛选会让一条规则**永远筛不出东西**却看不出来。该前提由下面一条断言看守。
 */
function scopedAudit(policy: Extract<DepPolicy, { kind: "audited" }>, pkg: PackageManifest) {
  const inScope = [...policy.forbidden, ...policy.peerOnly];
  return auditPackageDeps(pkg).filter((v) => inScope.some((n) => matchesName(v.name, n)));
}

/** 该违规是否被本包的「禁令尚未生效」标记暂时接住(语义:此刻**必须**仍然违规)。 */
function isPendingRemoval(
  policy: Extract<DepPolicy, { kind: "audited" }>,
  name: string,
): boolean {
  return (policy.pendingRemoval ?? []).some((p) => matchesName(name, p.name));
}

const describeViolations = (vs: readonly DepViolation[]) =>
  vs.map((v) => `${v.name} @ ${v.field}(${v.why})`);

const auditedRoots: readonly (PackageRoot & {
  policy: Extract<DepPolicy, { kind: "audited" }>;
})[] = PACKAGE_ROOTS.flatMap((r) => {
  const policy = PACKAGE_DEP_POLICIES[r.name];
  return policy?.kind === "audited" ? [{ ...r, policy }] : [];
});

/**
 * 断言给定名册里**每个包根都有依赖策略**,且策略表里没有对不上包根的死规则。
 *
 * ★ 这是本守卫的"总闸":没有它,给 `PACKAGE_ROOTS` 加第四个包根却忘了定规则,
 *   只会让该包**静默地完全不被审**,而全套用例照样绿 —— 与真的没有违规无法区分。
 *
 * ★ `roots` 可注入,是为了让本函数自身能被判别力用例驱动(同 `assertRootsContributed`)——
 *   不然要证明"漏定规则会响",只能去临时改 `package-roots.ts`,而那种一次性实验做完就没了。
 */
function assertPoliciesCoverRoots(roots: readonly PackageRoot[] = PACKAGE_ROOTS): void {
  const missing = roots.filter((r) => PACKAGE_DEP_POLICIES[r.name] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `以下包根未在 PACKAGE_DEP_POLICIES 里定规则,它们的依赖面根本没被审:\n` +
        missing.map((r) => `  · ${r.name} —— ${r.dir}`).join("\n") +
        `\n请显式声明 kind:"audited"(给出 forbidden / peerOnly)或 kind:"exempt"(写明理由)。` +
        `不要靠"查不到就放行"—— 那正是本守卫要根除的失效形态。`,
    );
  }
  const rootNames = new Set(roots.map((r) => r.name));
  const dead = Object.keys(PACKAGE_DEP_POLICIES).filter((n) => !rootNames.has(n));
  if (dead.length > 0) {
    throw new Error(
      `以下策略键在包根名册里没有对应包根,是死规则(包被改名或搬走?):\n` +
        dead.map((n) => `  · ${n}`).join("\n") +
        `\n死规则会让人误以为那个包还在被守。`,
    );
  }
}

describe("包依赖守卫 —— 策略表必须覆盖全部包根", () => {
  it("PACKAGE_ROOTS 与策略表逐项对应(漏定规则即失败,不得默认放行)", () => {
    expect(() => assertPoliciesCoverRoots()).not.toThrow();
  });

  it("判别力自证:新增包根却没给它定规则时,报红并指名是哪个包根", () => {
    // ★ 对应任务 2.4 的硬要求:「将来新增包根却忘了给它定规则」必须是一次**响亮的失败**,
    //   而不是默默按最宽松处理。用注入的假名册驱动,不必去改 package-roots.ts。
    //
    // ★ 假包根的名字必须是一个**不会成真**的名字。这里原先用的是 "adapters" ——
    //   adapters 包真的成立之后,它在策略表里有了规则,这条用例便只能靠
    //   「注入的重名项也被算作缺规则」而侥幸通过,判别力实际已经失去。
    const withExtra: readonly PackageRoot[] = [
      ...PACKAGE_ROOTS,
      {
        name: "no-such-package",
        dir: "/nonexistent/no-such-package",
        packageName: "@blksails/pi-web-no-such-package",
      },
    ];
    expect(() => assertPoliciesCoverRoots(withExtra)).toThrowError(/未在 PACKAGE_DEP_POLICIES/);
    expect(() => assertPoliciesCoverRoots(withExtra)).toThrowError(/no-such-package/);
  });

  it("判别力自证:策略表里有对不上包根的死规则时报红", () => {
    const shrunk = PACKAGE_ROOTS.filter((r) => r.name !== "runner");
    expect(() => assertPoliciesCoverRoots(shrunk)).toThrowError(/死规则/);
    expect(() => assertPoliciesCoverRoots(shrunk)).toThrowError(/runner/);
  });

  it("四个包根全部在被审,且与策略表声明一致(空扫即失败)", () => {
    // 找不到包根时,下面每条 per-root 断言都会因为"无物可查"而通过 —— 那是最像绿的一种失效。
    const declared = Object.entries(PACKAGE_DEP_POLICIES)
      .filter(([, p]) => p.kind === "audited")
      .map(([n]) => n)
      .sort();
    expect(auditedRoots.map((r) => r.name).sort()).toEqual(declared);
    // ★ 下限由 2 提到 4(R5.1 / design C5:守卫覆盖四包)。兼容层改成 audited 之后
    //   本仓**不再有任何 exempt 包根** —— 把这件事写成判据,免得哪天有人靠"改回 exempt"
    //   让红变绿:那正是本轮要根除的形态。
    expect(auditedRoots.length, "有包根不在被审 —— 守卫对它空转").toBeGreaterThanOrEqual(4);
  });

  it("每条 exempt 都写明了理由", () => {
    // 目前**一条 exempt 都没有**(四包全 audited),故本条此刻为空循环 —— 它是留给
    // 将来的:一旦有人重新引入豁免,理由就必须写出来。空理由的豁免与「忘了定规则」无法区分。
    for (const [name, policy] of Object.entries(PACKAGE_DEP_POLICIES)) {
      if (policy.kind !== "exempt") continue;
      expect(policy.why.trim().length, `包根 ${name} 的豁免没有理由`).toBeGreaterThan(20);
    }
  });

  it("执行 peer-only 判据的包根至少三个(空 peerOnly 不得悄悄扩散)", () => {
    // ★ `peerOnly: []` 让两条 per-root 断言变成空循环。兼容层那一项是**有理由的**空集
    //   (它是装配层),但空集不能成为让 peer 判据静默消失的通路 ——
    //   core / runner / adapters 三个库包必须始终在执行它。
    const enforcing = auditedRoots.filter((r) => r.policy.peerOnly.length > 0).map((r) => r.name);
    expect(enforcing.sort(), "库包的 agent SDK peer-only 判据被清空了").toEqual([
      "adapters",
      "core",
      "runner",
    ]);
  });

  it("pendingRemoval 只引用本包 forbidden 里的名字,且每条都写明理由", () => {
    // ★ 引用了一个本包并不禁止的名字,这条标记就**永远不可能过期** —— 它接不住任何违规,
    //   于是"标记未过期"一条也永远说不清自己在守什么。与上一条死规则断言同理。
    for (const root of auditedRoots) {
      for (const pending of root.policy.pendingRemoval ?? []) {
        expect(
          root.policy.forbidden,
          `${root.name} 的 pendingRemoval 引用了本包并未禁止的 "${pending.name}" —— 死标记`,
        ).toContain(pending.name);
        expect(
          pending.why.trim().length,
          `${root.name} 的 pendingRemoval "${pending.name}" 没写明何时移除`,
        ).toBeGreaterThan(20);
      }
    }
  });

  it("各包根的 forbidden 名字都在 FORBIDDEN_PACKAGE_DEPS 里(否则规则永远筛不出东西)", () => {
    // ★ `scopedAudit` 靠"全量审计后按名筛选"落地。策略里写了一个全量清单里没有的名字,
    //   表面上像是加了一条禁令,实际**永远匹配不到任何违规**——一条看着生效的死规则。
    const unknown = auditedRoots.flatMap((r) =>
      r.policy.forbidden.filter((n) => !FORBIDDEN_BY_NAME.has(n)).map((n) => `${r.name}: ${n}`),
    );
    expect(
      unknown,
      `以下包根规则引用了 FORBIDDEN_PACKAGE_DEPS 里不存在的依赖名:\n` +
        unknown.map((u) => `  · ${u}`).join("\n") +
        `\n请先把它加进 FORBIDDEN_PACKAGE_DEPS(带 why),再在包根规则里引用。`,
    ).toEqual([]);
  });
});

describe.each(auditedRoots)("包依赖守卫 —— $name 的声明层必须干净", (root) => {
  it("包根存在(空扫即失败,不得静默通过)", () => {
    expect(fs.existsSync(path.join(root.dir, "package.json")), `${root.dir} 没有 package.json`).toBe(
      true,
    );
  });

  it("dependencies / devDependencies 均不含本包被禁的依赖", () => {
    const all = scopedAudit(root.policy, manifestOf(root.dir));
    // 「禁令尚未生效」的名字在此被接住,其自身由下一条("标记未过期")反向看守。
    const violations = all.filter((v) => !isPendingRemoval(root.policy, v.name));
    expect(
      describeViolations(violations),
      `包 ${root.name} 的依赖声明出现了被禁项。源码干净但 package.json 里挂着它们,` +
        `消费方照样得装下来 —— 而拆包的全部价值就在那棵依赖树上。\n` +
        `修法:把用到它的实现摘去兼容层包(参考 sandbox-transport / session-store-postgres),` +
        `而不是放宽本名单、也不是把本包改成 exempt。`,
    ).toEqual([]);
  });

  it("pendingRemoval 标记未过期(标记在,则该依赖此刻必须仍被声明)", () => {
    // ★ 这是标记的**自毁装置**,与 `package-roots.ts` 里 pendingContributions 的
    //   「豁免过期即报红」完全同构。少了它,一条为过渡期加的标记会永久留下,
    //   而 R2.4 要求的「兼容层重新引入即失败」就永远不会响 —— 那正是本条存在的理由。
    //   于是两条约束在任何时刻恰有一条生效:标记在时"必须仍然违规",标记不在时"必须不违规"。
    //   **没有一刻是无人看管的,也没有留下需要后人回来打开的开关。**
    const all = scopedAudit(root.policy, manifestOf(root.dir));
    for (const pending of root.policy.pendingRemoval ?? []) {
      const hits = all.filter((v) => matchesName(v.name, pending.name));
      expect(
        describeViolations(hits),
        `包 ${root.name} 的 "${pending.name}" 已经不在依赖声明里了 —— ` +
          `pendingRemoval 标记过期,请把它从 PACKAGE_DEP_POLICIES.${root.name}.pendingRemoval 里删掉。\n` +
          `标记的语义是「此刻必须仍然违规」,而不是「可以违规」:留着它等于让这个依赖` +
          `**永久**免于禁令,将来它被重新引入时就没人会响了(R2.4)。\n` +
          `该标记登记的移除时机:${pending.why}`,
      ).not.toEqual([]);
    }
  });

  it("agent 运行时 SDK 以 peer 形式声明,而非硬依赖(R1.3)", () => {
    const pkg = manifestOf(root.dir);
    for (const name of root.policy.peerOnly) {
      expect(pkg.peerDependencies?.[name], `${name} 应出现在 ${root.name} 的 peerDependencies`)
        .toBeDefined();
      expect(pkg.dependencies?.[name], `${name} 不得出现在 ${root.name} 的 dependencies`)
        .toBeUndefined();
      expect(pkg.devDependencies?.[name], `${name} 不得出现在 ${root.name} 的 devDependencies`)
        .toBeUndefined();
    }
  });

  it("判别力自证:人为加入被禁依赖时报红并指出依赖名与所在字段", () => {
    // ★ 不能只验"真实声明是绿的"——那与"审计对本包恒返回空数组"无法区分。
    expect(root.policy.forbidden.length, `${root.name} 一条禁令都没有`).toBeGreaterThan(0);
    for (const name of root.policy.forbidden) {
      const injected = scopedAudit(root.policy, { devDependencies: { [name]: "^1.0.0" } });
      expect(injected.map((v) => `${v.name}@${v.field}`)).toEqual([`${name}@devDependencies`]);
      // 消息里必须同时有依赖名与字段名,否则修的人得自己翻三处。
      expect(describeViolations(injected)[0]).toContain(name);
      expect(describeViolations(injected)[0]).toContain("devDependencies");
    }
    // 子路径形态也要命中(如 `@modelcontextprotocol/sdk/client`)。
    const sub = `${root.policy.forbidden[0]}/some/deep/path`;
    expect(scopedAudit(root.policy, { dependencies: { [sub]: "1" } })).toHaveLength(1);
  });

  it("判别力自证:agent SDK 被误列为普通依赖时报红", () => {
    for (const name of root.policy.peerOnly) {
      const injected = scopedAudit(root.policy, { dependencies: { [name]: "*" } });
      expect(injected.map((v) => v.field)).toEqual(["dependencies"]);
      const injectedDev = scopedAudit(root.policy, { devDependencies: { [name]: "*" } });
      expect(injectedDev.map((v) => v.field)).toEqual(["devDependencies"]);
    }
  });
});

describe.each(auditedRoots.filter((r) => r.policy.srcTypeOnlyAgentSdk))(
  "包依赖守卫 —— $name 的源码对 agent SDK 只有类型引用(R1.3 源码侧)",
  (root) => {
    it("源码里没有对 agent SDK 的值导入", () => {
      // ★ 声明层查干净了还不够。R1.3 有两半:声明列 peer + 源码仅类型引用。
      //   少了这一半,一个 `import { AuthStorage } from "…"` 就能让 optional peer 形同虚设 ——
      //   内核走**源码直连**分发,消费方 `tsc` 会编译到那个文件,SDK 没装就直接编译失败。
      //   (`config/model-options.ts` 与 `vision-settings/vision-model-options.ts` 正是因此
      //    被摘去兼容层包的 `model-sources` 模块。)
      const srcDir = path.join(root.dir, "src");
      const walk = (d: string, out: string[] = []): string[] => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f, out);
          else if (e.name.endsWith(".ts")) out.push(f);
        }
        return out;
      };
      const files = walk(srcDir);
      expect(
        files.length,
        `${root.name}/src 扫到 0 个文件 —— 空扫的绿与真正的绿无法区分`,
      ).toBeGreaterThan(0);

      // 跨行匹配:本仓大量 import 写成多行,逐行扫会整条漏掉(依赖方向守卫踩过同一个坑)。
      const VALUE_IMPORT =
        /(?:^|\n)[ \t]*import[ \t]+(?!type[ \t])[^;]*?from[ \t]*["']@earendil-works\/[^"']*["']/g;
      const offenders = files
        .map((f) => ({ f, hits: [...fs.readFileSync(f, "utf8").matchAll(VALUE_IMPORT)] }))
        .filter((x) => x.hits.length > 0)
        .map((x) => path.relative(root.dir, x.f));

      expect(
        offenders,
        `以下 ${root.name} 文件**值**导入了 agent 运行时 SDK,与 R1.3 冲突:\n` +
          offenders.map((o) => `  ${o}\n`).join("") +
          `修法:把该文件摘去兼容层包(参考 src/model-sources/),或改为 \`import type\`。`,
      ).toEqual([]);
    });
  },
);

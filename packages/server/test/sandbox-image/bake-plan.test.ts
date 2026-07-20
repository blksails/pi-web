/**
 * bake-plan 单元测试(spec sandbox-baked-agent-image,任务 1.2;Req 2.1-2.6)。
 *
 * 纯函数烘焙计划:经注入的 BakeFsPort(内存实现)覆盖全部决策路径——
 * 收集(入口/package.json/.pi/ 全量)、排除规则逐项(node_modules/.git/dist/.installed/
 * 本地缓存,含 .pi/web/dist 例外)、MISSING_ENTRY / SOURCE_NOT_DIR 错误路径、
 * bundle vs --no-bundle 的 entry/files/Dockerfile 差异、tag=内容哈希确定性与显式覆盖、
 * 镜像名/模板名复用 template-name 派生。
 */
import { describe, it, expect } from "vitest";
import {
  computeBakePlan,
  isBakeExcluded,
  BAKE_EXCLUDES,
  BAKE_BUNDLE_EXTERNALS,
  type BakeFsPort,
  type BakePlan,
  type BakePlanOptions,
} from "../../src/sandbox-image/index.js";
import {
  deriveImageName,
  deriveTemplateName,
} from "../../src/sandbox-image/index.js";

// ---------------------------------------------------------------------------
// 内存 BakeFsPort(design.md §bake-plan:单测用内存实现)
// ---------------------------------------------------------------------------

/** rel 路径(posix)→ 文件内容;根为 memFs 的 root 参数。 */
type Tree = Record<string, string>;

function memFs(root: string, tree: Tree): BakeFsPort {
  const files = new Map<string, Buffer>();
  for (const [rel, content] of Object.entries(tree)) {
    files.set(`${root}/${rel}`, Buffer.from(content));
  }
  const isDir = (p: string): boolean => {
    const prefix = p.endsWith("/") ? p : `${p}/`;
    for (const key of files.keys()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  };
  return {
    exists: (p) => files.has(p) || isDir(p),
    listFiles: (dir) => {
      if (files.has(dir)) throw new Error(`ENOTDIR: not a directory: ${dir}`);
      if (!isDir(dir)) throw new Error(`ENOENT: no such directory: ${dir}`);
      const prefix = `${dir}/`;
      return [...files.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length))
        .sort();
    },
    readFile: (p) => {
      const buf = files.get(p);
      if (!buf) throw new Error(`ENOENT: no such file: ${p}`);
      return Buffer.from(buf);
    },
  };
}

const SRC = "/Users/x/agents/demo-agent";
const BASE_IMAGE = "pi-clouds/agent-runner:pi";

/** 标准源树:入口 index.ts + package.json + .pi/ 全量 + 应排除的各类目录/文件。 */
const baseTree: Tree = {
  "index.ts": "export default { name: 'demo' };\n",
  "package.json": '{"name":"demo-agent"}\n',
  "routes/handler.ts": "export const handler = 1;\n",
  ".pi/config.json": "{}\n",
  ".pi/skills/hello/SKILL.md": "# hello\n",
  ".pi/web/src/app.tsx": "<App/>\n",
  ".pi/web/dist/index.js": "/* built webext */\n",
  ".pi/web/dist/assets/app.css": ".a{}\n",
  "node_modules/dep/index.js": "module.exports = 1;\n",
  ".git/HEAD": "ref: refs/heads/main\n",
  "dist/index.js": "/* stale local build */\n",
  ".installed": "marker\n",
  ".cache/tmp.bin": "cache\n",
  ".DS_Store": "junk\n",
};

function opts(overrides: Partial<BakePlanOptions> = {}): BakePlanOptions {
  return { sourceDir: SRC, baseImage: BASE_IMAGE, bundle: true, ...overrides };
}

function planOrThrow(
  o: BakePlanOptions,
  fs: BakeFsPort,
): BakePlan {
  const result = computeBakePlan(o, fs);
  if (!result.ok) {
    throw new Error(`expected ok plan, got ${result.error.code}: ${result.error.detail}`);
  }
  return result.value;
}

const dests = (plan: BakePlan): string[] => plan.files.map((f) => f.dest);

// ---------------------------------------------------------------------------
// 收集(Req 2.1)
// ---------------------------------------------------------------------------

describe("computeBakePlan — 收集(bundle 模式,Req 2.1)", () => {
  it("收 package.json 与 .pi/ 全量(skills/config/web 源与 web/dist 产物)", () => {
    const plan = planOrThrow(opts(), memFs(SRC, baseTree));
    expect(dests(plan)).toEqual(
      expect.arrayContaining([
        "package.json",
        ".pi/config.json",
        ".pi/skills/hello/SKILL.md",
        ".pi/web/src/app.tsx",
        ".pi/web/dist/index.js",
        ".pi/web/dist/assets/app.css",
      ]),
    );
  });

  it("bundle=true 时 routes/ 等源文件与入口不进 files(由 bundle 内联)", () => {
    const plan = planOrThrow(opts(), memFs(SRC, baseTree));
    expect(dests(plan)).not.toContain("routes/handler.ts");
    expect(dests(plan)).not.toContain("index.ts");
  });

  it("bundleEntryPoint = 源入口绝对路径;entry = index.js(bundle 产物名)", () => {
    const plan = planOrThrow(opts(), memFs(SRC, baseTree));
    expect(plan.bundleEntryPoint).toBe(`${SRC}/index.ts`);
    expect(plan.entry).toBe("index.js");
  });

  it("files 的 src 为源内绝对路径、dest 为 staging 相对路径", () => {
    const plan = planOrThrow(opts(), memFs(SRC, baseTree));
    for (const f of plan.files) {
      expect(f.src).toBe(`${SRC}/${f.dest}`);
    }
  });

  it("package.json 缺失时不收也不报错", () => {
    const tree = { ...baseTree };
    delete tree["package.json"];
    const plan = planOrThrow(opts(), memFs(SRC, tree));
    expect(dests(plan)).not.toContain("package.json");
  });

  it(".pi/ 缺失时计划仍成立(files 可只含 package.json)", () => {
    const plan = planOrThrow(
      opts(),
      memFs(SRC, { "index.ts": "x", "package.json": "{}" }),
    );
    expect(dests(plan)).toEqual(["package.json"]);
  });

  it("sourceDir 尾斜杠不影响结果", () => {
    const fs = memFs(SRC, baseTree);
    const a = planOrThrow(opts(), fs);
    const b = planOrThrow(opts({ sourceDir: `${SRC}/` }), fs);
    expect(dests(b)).toEqual(dests(a));
    expect(b.tag).toBe(a.tag);
  });
});

describe("computeBakePlan — 收集(--no-bundle,Req 2.1)", () => {
  it("递归收全部源文件(含入口与 routes/),仍应用排除规则", () => {
    const plan = planOrThrow(opts({ bundle: false }), memFs(SRC, baseTree));
    expect(dests(plan)).toEqual(
      expect.arrayContaining([
        "index.ts",
        "routes/handler.ts",
        "package.json",
        ".pi/config.json",
        ".pi/web/dist/index.js",
      ]),
    );
    expect(dests(plan)).not.toContain("node_modules/dep/index.js");
    expect(dests(plan)).not.toContain(".git/HEAD");
    expect(dests(plan)).not.toContain("dist/index.js");
  });

  it("entry = 源入口文件名(index.ts);无 bundleEntryPoint", () => {
    const plan = planOrThrow(opts({ bundle: false }), memFs(SRC, baseTree));
    expect(plan.entry).toBe("index.ts");
    expect(plan.bundleEntryPoint).toBeUndefined();
  });

  it("js 入口源(index.js)时 entry = index.js", () => {
    const plan = planOrThrow(
      opts({ bundle: false }),
      memFs(SRC, { "index.js": "module.exports = {};" }),
    );
    expect(plan.entry).toBe("index.js");
  });
});

// ---------------------------------------------------------------------------
// 入口探测与错误路径(Req 2.4)
// ---------------------------------------------------------------------------

describe("computeBakePlan — 入口探测(Req 2.4)", () => {
  it("探测顺序与 resolveSpawnCommand 一致:先 index.js 后 index.ts", () => {
    const plan = planOrThrow(
      opts(),
      memFs(SRC, { "index.js": "a", "index.ts": "b" }),
    );
    expect(plan.bundleEntryPoint).toBe(`${SRC}/index.js`);
  });

  it("两者都无 → MISSING_ENTRY,detail 指出缺失项与目录", () => {
    const result = computeBakePlan(
      opts(),
      memFs(SRC, { "package.json": "{}", ".pi/config.json": "{}" }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("MISSING_ENTRY");
    expect(result.error.detail).toContain("index.js");
    expect(result.error.detail).toContain("index.ts");
    expect(result.error.detail).toContain(SRC);
  });

  it("sourceDir 不存在 → SOURCE_NOT_DIR", () => {
    const result = computeBakePlan(
      opts({ sourceDir: "/nope/absent" }),
      memFs(SRC, baseTree),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SOURCE_NOT_DIR");
    expect(result.error.detail).toContain("/nope/absent");
  });

  it("sourceDir 指向文件而非目录 → SOURCE_NOT_DIR", () => {
    const result = computeBakePlan(
      opts({ sourceDir: `${SRC}/package.json` }),
      memFs(SRC, baseTree),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("SOURCE_NOT_DIR");
  });
});

// ---------------------------------------------------------------------------
// 排除规则(Req 2.5)
// ---------------------------------------------------------------------------

describe("排除规则 BAKE_EXCLUDES(Req 2.5)", () => {
  it("常量导出且覆盖全部约定项(开发者可查知)", () => {
    expect(BAKE_EXCLUDES).toEqual(
      expect.arrayContaining([
        "node_modules/",
        ".git/",
        "dist/",
        ".installed",
        ".cache/",
        ".DS_Store",
      ]),
    );
  });

  it.each([
    "node_modules/dep/index.js",
    ".git/HEAD",
    "dist/index.js",
    "sub/dist/bundle.js",
    ".installed",
    ".cache/tmp.bin",
    ".DS_Store",
    "sub/.DS_Store",
    ".pi/web/node_modules/x.js",
  ])("排除 %s", (rel) => {
    expect(isBakeExcluded(rel)).toBe(true);
  });

  it.each([
    ".pi/web/dist/index.js",
    ".pi/web/dist/assets/app.css",
    "index.ts",
    "routes/handler.ts",
    ".pi/skills/hello/SKILL.md",
    "distX/keep.js",
  ])("保留 %s(含 .pi/web/dist 例外)", (rel) => {
    expect(isBakeExcluded(rel)).toBe(false);
  });

  it("计划产出的 files 全部通过排除规则", () => {
    for (const bundle of [true, false]) {
      const plan = planOrThrow(opts({ bundle }), memFs(SRC, baseTree));
      for (const dest of dests(plan)) {
        expect(isBakeExcluded(dest)).toBe(false);
      }
      expect(dests(plan)).toContain(".pi/web/dist/index.js");
    }
  });
});

// ---------------------------------------------------------------------------
// Dockerfile 文本(Req 2.2/2.6;design「烘焙镜像契约」)
// ---------------------------------------------------------------------------

describe("computeBakePlan — Dockerfile 文本(Req 2.2/2.6)", () => {
  it("bundle 形态:FROM 基座 + COPY + AGENT_CWD + AGENT_CMD(entry=index.js)+ 编译缓存预热", () => {
    const plan = planOrThrow(opts(), memFs(SRC, baseTree));
    const agentCmd =
      "node /usr/local/lib/node_modules/@blksails/pi-web-server/runner-bootstrap.mjs --agent /workspace/agent/index.js --cwd /workspace/agent --agent-dir /root/.pi/agent";
    expect(plan.dockerfile).toBe(
      [
        `FROM ${BASE_IMAGE}`,
        "COPY staged/ /workspace/agent/",
        "ENV AGENT_CWD=/workspace/agent",
        `ENV AGENT_CMD="${agentCmd}"`,
        // 冷启动优化:V8 编译缓存烘进镜像层(构建期 timeout 预热一次 AGENT_CMD)。
        "ENV NODE_COMPILE_CACHE=/opt/node-compile-cache",
        `RUN timeout 25 ${agentCmd} < /dev/null > /dev/null 2>&1 || true`,
        "",
      ].join("\n"),
    );
  });

  it("--no-bundle 形态:AGENT_CMD 指向源入口(可为 index.ts)", () => {
    const plan = planOrThrow(opts({ bundle: false }), memFs(SRC, baseTree));
    expect(plan.dockerfile).toContain(
      "--agent /workspace/agent/index.ts --cwd /workspace/agent --agent-dir /root/.pi/agent",
    );
    expect(plan.dockerfile).toContain(`FROM ${BASE_IMAGE}`);
  });

  it("baseImage 可替换(ACS 变体等)", () => {
    const plan = planOrThrow(
      opts({ baseImage: "registry.example/agent-runner:acs" }),
      memFs(SRC, baseTree),
    );
    expect(plan.dockerfile.startsWith("FROM registry.example/agent-runner:acs\n")).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------
// externals(bundle 模式 esbuild 用)
// ---------------------------------------------------------------------------

describe("externals 常量", () => {
  it("= pi SDK 两包(与 scripts/build-server.mjs EXTERNAL 精确名一致)+ @blksails/*", () => {
    expect(BAKE_BUNDLE_EXTERNALS).toEqual([
      "@earendil-works/pi-coding-agent",
      "@earendil-works/pi-ai",
      "@blksails/*",
    ]);
    const plan = planOrThrow(opts(), memFs(SRC, baseTree));
    expect(plan.externals).toEqual([...BAKE_BUNDLE_EXTERNALS]);
  });
});

// ---------------------------------------------------------------------------
// tag(Req 2.3/2.6:缺省内容哈希确定性;显式覆盖)
// ---------------------------------------------------------------------------

describe("computeBakePlan — tag(Req 2.3/2.6)", () => {
  it("缺省 tag = 12 位 hex 内容哈希,同输入恒同输出", () => {
    const a = planOrThrow(opts(), memFs(SRC, baseTree));
    const b = planOrThrow(opts(), memFs(SRC, baseTree));
    expect(a.tag).toMatch(/^[0-9a-f]{12}$/);
    expect(a.tag).toBe(b.tag);
  });

  it("staging 文件内容变化 → tag 变化", () => {
    const a = planOrThrow(opts(), memFs(SRC, baseTree));
    const b = planOrThrow(
      opts(),
      memFs(SRC, { ...baseTree, ".pi/config.json": '{"changed":true}\n' }),
    );
    expect(b.tag).not.toBe(a.tag);
  });

  it("bundle 模式下入口文件字节参与哈希(入口不在 files 中也影响 tag)", () => {
    const a = planOrThrow(opts(), memFs(SRC, baseTree));
    const b = planOrThrow(
      opts(),
      memFs(SRC, { ...baseTree, "index.ts": "export default { name: 'v2' };\n" }),
    );
    expect(b.tag).not.toBe(a.tag);
  });

  it("bundle 模式下非入口源文件(routes/ 等,被 bundle 内联)字节参与哈希 → tag 变化", () => {
    // 复核 REMEDIATION(Req 2.3 内容寻址):routes/handler.ts 不进 files(bundle 内联),
    // 但它决定 bundle 产物内容,变更必须反映到缺省 tag,否则新镜像被旧 tag 掩盖。
    const a = planOrThrow(opts(), memFs(SRC, baseTree));
    const b = planOrThrow(
      opts(),
      memFs(SRC, { ...baseTree, "routes/handler.ts": "export const handler = 2;\n" }),
    );
    expect(b.tag).not.toBe(a.tag);
  });

  it("--no-bundle 模式同语义:routes/ 源变更 → tag 变化", () => {
    const a = planOrThrow(opts({ bundle: false }), memFs(SRC, baseTree));
    const b = planOrThrow(
      opts({ bundle: false }),
      memFs(SRC, { ...baseTree, "routes/handler.ts": "export const handler = 2;\n" }),
    );
    expect(b.tag).not.toBe(a.tag);
  });

  it("bundle 与 --no-bundle 的 tag 哈希输入同为全部非排除源 → 同源同 tag", () => {
    // 两形态的 staging 输入集(全部非排除源文件)一致,缺省 tag 应一致——
    // 同一源的两种烘焙形态在内容寻址上等价。
    const a = planOrThrow(opts(), memFs(SRC, baseTree));
    const b = planOrThrow(opts({ bundle: false }), memFs(SRC, baseTree));
    expect(b.tag).toBe(a.tag);
  });

  // #27:基座是产物的决定性输入,必须进 tag。此前只哈希源文件,「源不变只换基座」tag 不变 ⇒
  // 同 tag 下并存不同产物(后推覆盖先推)、服务端 bake 侧更会幂等短路使新基座永不生效。
  it("基座变化 → tag 必变(#27),且镜像名/模板名随之不同名", () => {
    const a = planOrThrow(opts({ baseImage: "pi-clouds/agent-runner:pi-slim-0.4.2" }), memFs(SRC, baseTree));
    const b = planOrThrow(opts({ baseImage: "pi-clouds/agent-runner:pi-slim-0.5.0" }), memFs(SRC, baseTree));
    expect(b.tag).not.toBe(a.tag);
    // 不同名才不会覆盖旧产物——这正是内容寻址要守住的性质。
    expect(b.imageName).not.toBe(a.imageName);
    expect(b.templateName).not.toBe(a.templateName);
  });

  it("同基座同内容 → tag 恒定(引入基座不破坏确定性,#27)", () => {
    const a = planOrThrow(opts(), memFs(SRC, baseTree));
    const b = planOrThrow(opts(), memFs(SRC, baseTree));
    expect(b.tag).toBe(a.tag);
    expect(a.tag).toMatch(/^[0-9a-f]{12}$/);
  });

  it("显式 tag 优先:基座变化也不改写它(逃生舱语义不受 #27 影响)", () => {
    const a = planOrThrow(opts({ tag: "pinned", baseImage: "pi-clouds/agent-runner:pi-slim-0.4.2" }), memFs(SRC, baseTree));
    const b = planOrThrow(opts({ tag: "pinned", baseImage: "pi-clouds/agent-runner:pi-slim-0.5.0" }), memFs(SRC, baseTree));
    expect(a.tag).toBe("pinned");
    expect(b.tag).toBe("pinned");
  });

  it("排除项内容变化不影响 tag(node_modules 等不是 staging 输入)", () => {
    const a = planOrThrow(opts(), memFs(SRC, baseTree));
    const b = planOrThrow(
      opts(),
      memFs(SRC, { ...baseTree, "node_modules/dep/index.js": "changed" }),
    );
    expect(b.tag).toBe(a.tag);
  });

  it("显式 opts.tag 优先于内容哈希", () => {
    const plan = planOrThrow(opts({ tag: "v1" }), memFs(SRC, baseTree));
    expect(plan.tag).toBe("v1");
    expect(plan.imageName.endsWith(":v1")).toBe(true);
  });

  it("显式 tag 含 `.` 时与 template-name 一致归一(plan.tag 即命名中的最终 tag)", () => {
    const plan = planOrThrow(opts({ tag: "1.2.3" }), memFs(SRC, baseTree));
    expect(plan.tag).toBe("1-2-3");
    expect(plan.imageName.endsWith(":1-2-3")).toBe(true);
    expect(plan.templateName.endsWith(".1-2-3")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 镜像名/模板名(Req 2.6:复用 template-name 派生,不重写逻辑)
// ---------------------------------------------------------------------------

describe("computeBakePlan — 镜像名/模板名(Req 2.6)", () => {
  it("imageName/templateName 与 template-name 派生逐字节一致(policySource=sourceDir)", () => {
    const plan = planOrThrow(opts(), memFs(SRC, baseTree));
    const identity = { policySource: SRC };
    expect(plan.imageName).toBe(deriveImageName(identity, plan.tag));
    expect(plan.templateName).toBe(deriveTemplateName(identity, plan.tag));
  });
});

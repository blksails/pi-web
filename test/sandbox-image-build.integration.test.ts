/**
 * 构建脚本夹具集成测试(spec sandbox-baked-agent-image,任务 3.3;Req 7.1)。
 *
 * 被测对象 = 「真实 fs 适配器(createNodeBakeFs)+ computeBakePlan + staging 决策」的
 * 组合:单测(packages/server/test/sandbox-image/bake-plan.test.ts)已用内存 BakeFsPort
 * 覆盖纯决策,本测试在**真实盘面**(os.tmpdir 夹具副本)补齐——真实 fs 适配器契约
 * (listFiles 递归 + 相对路径 + posix 分隔)、staging 文件清单/排除、Dockerfile 文本形状、
 * tag 内容哈希确定性。同时经脚本导出的 loadBakePlanModule 走 jiti 编程式加载,
 * 与 `node scripts/build-agent-image.mjs` 直跑同一条内核加载路径。
 *
 * 零 docker 依赖:只调用导出的纯组合函数,不触发脚本 main(入口守卫拦截,见脚本尾),
 * 全程不 spawn docker/kind/kubectl,无 docker 环境可跑。
 *
 * 夹具 test/fixtures/baked-agent-fixture:可提交部分入库(index.ts/package.json/routes/
 * .pi/ 全量含 web/dist 假产物/dist 宿主垃圾/.installed/.cache;dist 靠夹具内 .gitignore
 * 负规则入库);node_modules/、.git/、.DS_Store git 不让提交(嵌套 .git 被 git 拒绝,
 * 其余被根 .gitignore 忽略),由 beforeAll 在 tmp 副本中动态补齐,保证排除规则逐项
 * 在真实盘面命中。
 *
 * @vitest-environment node
 *   (脚本顶层 import esbuild,esbuild 在 jsdom realm 下 TextEncoder 产物不是本 realm
 *   Uint8Array 而拒绝加载;本测试纯 node 盘面无 DOM 依赖,按文件覆写环境。)
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createNodeBakeFs,
  loadBakePlanModule,
} from "../scripts/build-agent-image.mjs";
import type * as bakePlanNs from "../packages/server/src/sandbox-image/bake-plan.js";

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "baked-agent-fixture",
);
const BASE_IMAGE = "pi-clouds/agent-runner:pi";

/** git 不可提交、由本测试动态补齐的排除占位(rel → 内容)。 */
const DYNAMIC_PLACEHOLDERS: Record<string, string> = {
  "node_modules/dep/index.js": "module.exports = 1;\n",
  "node_modules/dep/package.json": '{"name":"dep"}\n',
  ".git/HEAD": "ref: refs/heads/main\n",
  ".git/config": "[core]\n\trepositoryformatversion = 0\n",
  ".DS_Store": "finder junk\n",
};

/** 夹具全部非排除源文件(相对路径,已按 computeBakePlan 的默认 sort 排序)。 */
const NON_EXCLUDED_SORTED = [
  ".gitignore",
  ".pi/config.json",
  ".pi/web/dist/assets/app.css",
  ".pi/web/dist/index.js",
  ".pi/web/index.ts",
  "index.ts",
  "package.json",
  "routes/hello.ts",
];

/** bundle 模式 staging 清单 = package.json + .pi/ 全量(其余源由 esbuild 内联)。 */
const BUNDLE_DESTS = NON_EXCLUDED_SORTED.filter(
  (rel) => rel === "package.json" || rel.startsWith(".pi/"),
);

/** 夹具盘面上应被排除的相对路径(动态占位 + 入库的 dist/.installed/.cache)。 */
const EXCLUDED_RELS = [
  ...Object.keys(DYNAMIC_PLACEHOLDERS),
  "dist/stale.js",
  ".installed",
  ".cache/placeholder.txt",
];

let tmpRoot: string;
let srcDir: string;
let bakeFs: ReturnType<typeof createNodeBakeFs>;
let kernel: typeof bakePlanNs;

function writePlaceholder(root: string, rel: string, content: string): void {
  const abs = path.join(root, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

function opts(
  overrides: Partial<bakePlanNs.BakePlanOptions> = {},
): bakePlanNs.BakePlanOptions {
  return { sourceDir: srcDir, baseImage: BASE_IMAGE, bundle: true, ...overrides };
}

function planOrThrow(o: bakePlanNs.BakePlanOptions): bakePlanNs.BakePlan {
  const result = kernel.computeBakePlan(o, bakeFs);
  if (!result.ok) {
    throw new Error(
      `expected ok plan, got ${result.error.code}: ${result.error.detail}`,
    );
  }
  return result.value;
}

const dests = (plan: bakePlanNs.BakePlan): string[] =>
  plan.files.map((f) => f.dest);

beforeAll(async () => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "baked-agent-fixture-"));
  srcDir = path.join(tmpRoot, "agent");
  fs.cpSync(FIXTURE_DIR, srcDir, { recursive: true });
  for (const [rel, content] of Object.entries(DYNAMIC_PLACEHOLDERS)) {
    writePlaceholder(srcDir, rel, content);
  }
  bakeFs = createNodeBakeFs();
  // 走脚本的真实内核加载路径(createRequire 锚定 server 包 + jiti 编程式 import)。
  kernel = (await loadBakePlanModule()) as typeof bakePlanNs;
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 入口守卫:以模块形式 import 脚本不得自跑 main(否则 parseArgs 对 vitest argv die)
// ---------------------------------------------------------------------------

describe("scripts/build-agent-image.mjs 模块形态", () => {
  it("导出 createNodeBakeFs/loadBakePlanModule,import 不触发 main(本套件能跑即证据)", () => {
    expect(typeof createNodeBakeFs).toBe("function");
    expect(typeof loadBakePlanModule).toBe("function");
    expect(typeof kernel.computeBakePlan).toBe("function");
    expect(typeof kernel.isBakeExcluded).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 真实 fs 适配器契约(bake-plan.ts BakeFsPort docstring:递归 + 相对 + posix)
// ---------------------------------------------------------------------------

describe("createNodeBakeFs — 真实盘面契约", () => {
  it("listFiles 递归列出全部文件:相对路径、posix 分隔、仅文件不含目录", () => {
    const listed = bakeFs.listFiles(srcDir);
    // 递归:覆盖 1/2/4 级深度
    expect(listed).toEqual(
      expect.arrayContaining([
        "index.ts",
        "routes/hello.ts",
        ".pi/web/dist/assets/app.css",
      ]),
    );
    for (const rel of listed) {
      expect(path.isAbsolute(rel)).toBe(false);
      expect(rel).not.toContain("\\");
      expect(rel.startsWith(srcDir)).toBe(false);
      // 仅文件:每个条目在盘面上是真实文件而非目录
      expect(fs.statSync(path.join(srcDir, ...rel.split("/"))).isFile()).toBe(
        true,
      );
    }
  });

  it("listFiles 不做排除(排除是 bake-plan 决策的职责):node_modules/.git 等照列", () => {
    const listed = bakeFs.listFiles(srcDir);
    for (const rel of EXCLUDED_RELS) {
      expect(listed).toContain(rel);
    }
  });

  it("listFiles 对文件路径抛错(not a directory);对不存在路径抛错", () => {
    expect(() => bakeFs.listFiles(path.join(srcDir, "package.json"))).toThrow(
      /not a directory/,
    );
    expect(() => bakeFs.listFiles(path.join(srcDir, "nope-absent"))).toThrow();
  });

  it("listFiles 解引用 symlink:指向文件的链接按文件收录", () => {
    const dir = fs.mkdtempSync(path.join(tmpRoot, "symlink-"));
    fs.writeFileSync(path.join(dir, "real.txt"), "x");
    fs.symlinkSync(path.join(dir, "real.txt"), path.join(dir, "link.txt"));
    expect(bakeFs.listFiles(dir).sort()).toEqual(["link.txt", "real.txt"]);
  });

  it("exists:文件/目录为 true,缺失为 false;readFile 回真实字节", () => {
    expect(bakeFs.exists(srcDir)).toBe(true);
    expect(bakeFs.exists(path.join(srcDir, "index.ts"))).toBe(true);
    expect(bakeFs.exists(path.join(srcDir, "nope-absent"))).toBe(false);
    const raw = bakeFs.readFile(path.join(srcDir, "package.json"));
    expect(Buffer.isBuffer(raw)).toBe(true);
    expect(JSON.parse(raw.toString("utf8")).name).toBe("baked-agent-fixture");
  });
});

// ---------------------------------------------------------------------------
// staging 清单 + 排除(bundle 模式,Req 2.1/2.5 在真实盘面)
// ---------------------------------------------------------------------------

describe("computeBakePlan × 真实 fs — staging 清单(bundle 模式)", () => {
  it("files = package.json + .pi/ 全量(精确清单);routes 源与入口不进清单(bundle 内联)", () => {
    const plan = planOrThrow(opts());
    expect(dests(plan)).toEqual(BUNDLE_DESTS);
    expect(dests(plan)).not.toContain("routes/hello.ts");
    expect(dests(plan)).not.toContain("index.ts");
  });

  it("入口产物形态:entry=index.js(bundle 产物名),bundleEntryPoint=源入口真实绝对路径", () => {
    const plan = planOrThrow(opts());
    expect(plan.entry).toBe("index.js");
    expect(plan.bundleEntryPoint).toBe(`${srcDir}/index.ts`);
    expect(fs.existsSync(plan.bundleEntryPoint!)).toBe(true);
  });

  it("排除:node_modules/.git/.cache/.DS_Store/dist/.installed 全部不进清单;.pi/web/dist 保留", () => {
    const plan = planOrThrow(opts());
    const listed = dests(plan);
    for (const rel of EXCLUDED_RELS) {
      expect(listed).not.toContain(rel);
    }
    // 排除规则与盘面对齐:适配器列得出、计划筛得掉
    const excludedOnDisk = bakeFs
      .listFiles(srcDir)
      .filter((rel) => kernel.isBakeExcluded(rel))
      .sort();
    expect(excludedOnDisk).toEqual([...EXCLUDED_RELS].sort());
    // dist/ 规则的唯一例外:webext 运行产物保留
    expect(listed).toContain(".pi/web/dist/index.js");
    expect(listed).toContain(".pi/web/dist/assets/app.css");
  });

  it("files 的 src 均为真实存在的盘面文件,且 src = sourceDir + '/' + dest", () => {
    const plan = planOrThrow(opts());
    expect(plan.files.length).toBeGreaterThan(0);
    for (const f of plan.files) {
      expect(f.src).toBe(`${srcDir}/${f.dest}`);
      expect(fs.statSync(f.src).isFile()).toBe(true);
    }
  });
});

describe("computeBakePlan × 真实 fs — staging 清单(--no-bundle)", () => {
  it("files = 全部非排除源(精确清单,含入口与 routes 源);entry=index.ts", () => {
    const plan = planOrThrow(opts({ bundle: false }));
    expect(dests(plan)).toEqual(NON_EXCLUDED_SORTED);
    expect(plan.entry).toBe("index.ts");
    expect(plan.bundleEntryPoint).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dockerfile 文本形状(Req 2.2/2.6 在真实盘面)
// ---------------------------------------------------------------------------

describe("computeBakePlan × 真实 fs — Dockerfile 文本形状", () => {
  it("bundle 形态:FROM/COPY staged\\//ENV AGENT_CWD/ENV AGENT_CMD(--agent index.js)+编译缓存预热,逐行精确", () => {
    const plan = planOrThrow(opts());
    const agentCmd =
      "node /usr/local/lib/node_modules/@blksails/pi-web-server/runner-bootstrap.mjs --agent /workspace/agent/index.js --cwd /workspace/agent --agent-dir /root/.pi/agent";
    expect(plan.dockerfile).toBe(
      [
        `FROM ${BASE_IMAGE}`,
        "COPY staged/ /workspace/agent/",
        "ENV AGENT_CWD=/workspace/agent",
        `ENV AGENT_CMD="${agentCmd}"`,
        // 冷启动优化:V8 编译缓存层(构建期预热,timeout 兜底)。
        "ENV NODE_COMPILE_CACHE=/opt/node-compile-cache",
        `RUN timeout 25 ${agentCmd} < /dev/null > /dev/null 2>&1 || true`,
        "",
      ].join("\n"),
    );
  });

  it("--no-bundle 形态:AGENT_CMD 指向源入口 index.ts,其余形状一致", () => {
    const plan = planOrThrow(opts({ bundle: false }));
    expect(plan.dockerfile).toContain(`FROM ${BASE_IMAGE}\n`);
    expect(plan.dockerfile).toContain("COPY staged/ /workspace/agent/");
    expect(plan.dockerfile).toContain("ENV AGENT_CWD=/workspace/agent");
    expect(plan.dockerfile).toContain(
      "--agent /workspace/agent/index.ts --cwd /workspace/agent --agent-dir /root/.pi/agent",
    );
  });
});

// ---------------------------------------------------------------------------
// tag 内容哈希(Req 2.3 在真实盘面:确定性 + 排除项不参与)
// ---------------------------------------------------------------------------

describe("computeBakePlan × 真实 fs — tag 内容哈希", () => {
  it("缺省 tag = 12 位 hex;重复计算恒同;bundle 与 --no-bundle 同源同 tag", () => {
    const a = planOrThrow(opts());
    const b = planOrThrow(opts());
    const c = planOrThrow(opts({ bundle: false }));
    expect(a.tag).toMatch(/^[0-9a-f]{12}$/);
    expect(b.tag).toBe(a.tag);
    expect(c.tag).toBe(a.tag);
    expect(a.imageName.endsWith(`:${a.tag}`)).toBe(true);
    expect(a.templateName.endsWith(`.${a.tag}`)).toBe(true);
  });

  it("排除项不参与哈希:无 node_modules/.git 占位的纯净副本 tag 与主副本一致", () => {
    const pristine = path.join(tmpRoot, "pristine");
    fs.cpSync(FIXTURE_DIR, pristine, { recursive: true });
    const plan = planOrThrow(opts({ sourceDir: pristine }));
    expect(plan.tag).toBe(planOrThrow(opts()).tag);
  });

  it("bundle 模式下 routes 源(不进 files)内容变更 → tag 变化(内容寻址)", () => {
    const mutated = path.join(tmpRoot, "mutated");
    fs.cpSync(FIXTURE_DIR, mutated, { recursive: true });
    fs.appendFileSync(
      path.join(mutated, "routes", "hello.ts"),
      "// mutated\n",
    );
    const plan = planOrThrow(opts({ sourceDir: mutated }));
    expect(plan.tag).not.toBe(planOrThrow(opts()).tag);
    expect(dests(plan)).not.toContain("routes/hello.ts");
  });
});

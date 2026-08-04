// @vitest-environment node
/**
 * 预渲染 HTML pane(spec pane-build-prerendered-document,任务 1.2 / 2.2)。
 *
 * ★ 本 spec 要根治的失败模式是**静默丢失**:构建成功、产物却少一个 pane。所以每条断言都
 *   直接数 pane 集合里的条目,而不是「构建没抛错」—— 后者恰恰是缺陷现场的表现。
 *
 * 判据取舍:
 *  - 「内容原样写出」断言**逐字符相等**,不只断言键存在 —— 只有这样才能测出「被
 *    renderPaneDocument 二次包装」这种错法(那会让文档多一层 html/body,键照样在)。
 *  - 「仅入口时不变」用同一份声明跑两次(改动前的行为由既有 pane-build.test.ts 锁着),
 *    此处断言预渲染分支不产生脚本文件,即它没有误入打包路径。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverPaneModules, type PaneModuleLoader } from "@/server/cli/build/pane-discovery";
import { buildPaneArtifacts } from "@/server/cli/build/pane-build";
import { BuildError } from "@/server/cli/build/errors";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pane-prerendered-test-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const caps = {
  routes: [], surfaceKeys: [], surfaceCommands: [], attachments: "none",
  conversation: "none", downloads: false,
  events: { publish: [], subscribe: [] }, state: { read: [], write: [] },
};

const LOGS_HTML = "<!doctype html><html><head><title>日志</title></head><body><pre id=\"log\"></pre></body></html>";

function seed(path: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "// placeholder\n");
}

/**
 * 落一份汇总声明文件并经显式路径发现。求值走注入的 `load` 替身(与既有 pane-discovery
 * 单测同策略),不经真实 jiti —— 本测关心的是形态判别,与 TS 如何编译无关。
 */
async function discover(modules: readonly unknown[]) {
  const relPath = "panes-declaration.ts";
  const declPath = join(root, relPath);
  seed(declPath);
  const load: PaneModuleLoader = async (spec) => {
    if (spec !== declPath) throw new Error(`unexpected load: ${spec}`);
    return { default: { id: "test-panes", modules } };
  };
  return discoverPaneModules(root, relPath, load);
}

describe("预渲染 HTML pane — 声明层", () => {
  it("接受 document 形态,产出的模块带 document 且不带 entry", async () => {
    const d = await discover([{ id: "logs", title: "日志", document: LOGS_HTML, capabilities: caps }]);
    expect(d?.modules).toHaveLength(1);
    expect(d?.modules[0]?.document).toBe(LOGS_HTML);
    expect(d?.modules[0]?.entry).toBeUndefined();
  });

  it("同时给 entry 与 document → 拒绝,且指出是哪个 pane", async () => {
    const entry = join(root, "panes", "x.tsx");
    seed(entry);
    await expect(discover([
      { id: "both", title: "Both", entry, document: LOGS_HTML, capabilities: caps },
    ])).rejects.toThrow(/both/);
  });

  it("两者都不给 → 拒绝,且指出是哪个 pane", async () => {
    await expect(discover([{ id: "neither", title: "Neither", capabilities: caps }]))
      .rejects.toThrow(/neither/);
  });

  it("document 非字符串 → 拒绝,并点明类型不符(不静默按未给出处理)", async () => {
    const err = await discover([{ id: "bad", title: "Bad", document: 42, capabilities: caps }])
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BuildError);
    expect(String(err)).toMatch(/bad/);
    expect(String(err)).toMatch(/number/);
  });

  it("document 与 canvasStyles 并存 → 拒绝(预渲染文档不参与画布样式解析)", async () => {
    await expect(discover([
      { id: "styled", title: "Styled", document: LOGS_HTML, canvasStyles: true, capabilities: caps },
    ])).rejects.toThrow(/styled/);
  });
});

describe("预渲染 HTML pane — 构建层", () => {
  it("原样写出且进内联映射,不产生脚本文件", async () => {
    const outDir = join(root, "out");
    mkdirSync(outDir, { recursive: true });
    const d = await discover([{ id: "logs", title: "日志", document: LOGS_HTML, capabilities: caps }]);

    const built = await buildPaneArtifacts(d!.modules, { sourceRoot: root, outDir });

    // 逐字符相等:能测出「被 renderPaneDocument 二次包装」这种错法。
    expect(built.documents.logs).toBe(LOGS_HTML);
    expect(built.artifacts).toHaveLength(1);
    expect(built.artifacts[0]?.scriptPath).toBeUndefined();
    expect(existsSync(join(outDir, "pane-logs.html"))).toBe(true);
    expect(existsSync(join(outDir, "pane-logs.js"))).toBe(false);
  });

  it("混合声明:两形态并存,产出数 == 声明数且顺序一致", async () => {
    const outDir = join(root, "out2");
    mkdirSync(outDir, { recursive: true });
    const entry = join(root, "panes", "search.tsx");
    seed(entry);
    writeFileSync(entry, "export default function Search() { return null; }\n");

    const d = await discover([
      { id: "search", title: "搜图", entry, capabilities: caps },
      { id: "logs", title: "日志", document: LOGS_HTML, capabilities: caps },
    ]);
    const built = await buildPaneArtifacts(d!.modules, { sourceRoot: root, outDir });

    // ★ 直接数条目 —— 本 spec 的原始症状正是「构建成功但少一个」。
    expect(built.artifacts).toHaveLength(2);
    expect(Object.keys(built.documents).sort()).toEqual(["logs", "search"]);
    expect(built.artifacts.map((a) => a.id)).toEqual(["search", "logs"]);
    // 入口形态照旧有脚本,预渲染形态没有。
    expect(built.artifacts[0]?.scriptPath).toBeDefined();
    expect(built.artifacts[1]?.scriptPath).toBeUndefined();
  });
});

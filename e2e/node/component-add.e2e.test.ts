/**
 * demo 自举 e2e(spec cli-component-add,任务 6.1,Req 9.1–9.3)。
 *
 * 全链路:构建真实 CLI 命令产物 → 从产物 import 出 runAdd → 临时目录复制最小干净
 * source(examples/webext-runtime-code-agent)→ add 装入范例水印组件 → 按接线指引
 * 代行接线 → 真实 `buildWebExtension` 编译 → 产物含 `data-watermark-text` 标记。
 * 另覆盖 dry-run 零写入与拒绝路径(kind:"plugin" 包)。
 *
 * 夹具说明:临时 source 内放一个**极小 fake peer 包**(@blksails/pi-web-canvas-kit,
 * identity 版 define 三件套 + version)——真实用户 source 本就自带已安装的 peer,
 * 本仓根 node_modules 无 canvas-kit 链接(examples 走 tsconfig paths),故以夹具复现
 * 「已装 peer」形态;peer 探测与 esbuild 打包都吃这份夹具。canvas-kit 本体行为由
 * canvas-ui 套件覆盖,本 e2e 只验 add 管线与接线→构建闭环。
 *
 * Req 9.3:全程只写 os tmpdir 与 gitignored 的 dist/,结束断言仓库工作树无改动。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { buildWebExtension } from "@blksails/pi-web-kit/build";
import type { runAdd as RunAddType } from "@/server/cli/component/add-command";

const REPO = resolve(__dirname, "..", "..");
const WATERMARK_PACK = join(REPO, "examples", "canvas-component-watermark");
const CLEAN_SOURCE = join(REPO, "examples", "webext-runtime-code-agent");
const PLUGIN_PACK = join(REPO, "examples", "plugin-code-review-agent");

let tmp: string;
let runAdd: typeof RunAddType;

/** 在目标 source 内放极小 fake peer 包(见文件头夹具说明)。 */
function seedFakePeer(sourceDir: string): void {
  const pkgDir = join(sourceDir, "node_modules", "@blksails", "pi-web-canvas-kit");
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({
      name: "@blksails/pi-web-canvas-kit",
      version: "0.1.0",
      type: "module",
      main: "index.js",
    }),
  );
  writeFileSync(
    join(pkgDir, "index.js"),
    [
      "export const defineCanvasLayer = (x) => x;",
      "export const defineCanvasTool = (x) => x;",
      "export const defineCanvasAction = (x) => x;",
      "",
    ].join("\n"),
  );
}

function makeCleanSource(name: string): string {
  const dir = join(tmp, name);
  cpSync(CLEAN_SOURCE, dir, { recursive: true });
  seedFakePeer(dir);
  return dir;
}

function gitStatus(): string {
  return execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" }).trim();
}

let statusBefore: string;

beforeAll(async () => {
  statusBefore = gitStatus();
  tmp = mkdtempSync(join(tmpdir(), "pi-web-component-add-e2e-"));
  // 真实分发产物:构建 dist/cli-commands.mjs 并从产物 import runAdd(任务 3.2 观察态)。
  const { buildCliCommands, CLI_COMMANDS_OUT_FILE } = (await import(
    pathToFileURL(join(REPO, "scripts", "build-server.mjs")).href
  )) as {
    buildCliCommands: () => Promise<{ outfile: string }>;
    CLI_COMMANDS_OUT_FILE: string;
  };
  await buildCliCommands();
  const mod = (await import(pathToFileURL(CLI_COMMANDS_OUT_FILE).href)) as {
    runAdd: typeof RunAddType;
  };
  expect(typeof mod.runAdd).toBe("function");
  runAdd = mod.runAdd;
}, 120_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("组件源码车道自举(add → 接线 → build)", () => {
  it("add 装入 → 按指引接线 → buildWebExtension 产物含组件标记(9.1)", async () => {
    const sourceDir = makeCleanSource("host-agent");
    const lines: string[] = [];
    const code = await runAdd([WATERMARK_PACK, "--target", sourceDir], {
      cwd: tmp,
      write: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    const out = lines.join("\n");

    // 落盘与溯源。
    const dest = join(sourceDir, ".pi", "web", "components", "canvas-watermark");
    expect(existsSync(join(dest, "components", "watermark", "watermark.tsx"))).toBe(true);
    const prov = JSON.parse(readFileSync(join(dest, ".component.json"), "utf8")) as {
      id: string;
      origin: string;
      files: Record<string, string>;
    };
    expect(prov.id).toBe("canvas-watermark");
    expect(prov.origin).toBe(`local:${WATERMARK_PACK}`);
    expect(Object.values(prov.files).every((d) => d.startsWith("sha256:"))).toBe(true);

    // 严格按打印指引代行手工接线:import 行**逐字取自输出**(不自造)——守住
    // 「指引路径必须相对落点可解析」这一契约(bin 冒烟曾抓到指引给包内相对路径的缺陷)。
    const importLine = lines
      .flatMap((l) => l.split("\n"))
      .map((l) => l.trim())
      .find((l) => l.startsWith("import {"));
    expect(importLine).toBe(
      `import { watermarkBundle } from "./components/canvas-watermark/components/watermark/watermark";`,
    );
    if (importLine === undefined) throw new Error("unreachable");
    expect(out).toContain("canvasPlugins: [watermarkBundle],");
    const configPath = join(sourceDir, ".pi", "web", "web.config.tsx");
    const config = readFileSync(configPath, "utf8");
    const wired = config
      .replace(
        `import { defineWebExtension } from "@blksails/pi-web-kit";`,
        `import { defineWebExtension } from "@blksails/pi-web-kit";\n${importLine}`,
      )
      .replace(`capabilities: ["slots"],`, `capabilities: ["slots"],\n  canvasPlugins: [watermarkBundle],`);
    expect(wired).not.toBe(config);
    writeFileSync(configPath, wired);

    // 真实 webext 构建:入口 import 的组件源码被 bundle 递归编译。
    const outDir = join(sourceDir, ".pi", "web", "dist");
    const result = await buildWebExtension({
      id: "host-agent",
      targetApiVersion: "^0.1.0",
      entryDir: join(sourceDir, ".pi", "web"),
      outDir,
    });
    const bundle = readFileSync(result.entryOut, "utf8");
    expect(bundle).toContain("data-watermark-text");
    expect(bundle).toContain("watermark_apply");
  }, 120_000);

  it("dry-run:列出文件与指引、零写入(9.2)", async () => {
    const sourceDir = makeCleanSource("dry-agent");
    const before = readdirSync(join(sourceDir, ".pi", "web"));
    const lines: string[] = [];
    const code = await runAdd([WATERMARK_PACK, "--target", sourceDir, "--dry-run"], {
      cwd: tmp,
      write: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("components/watermark/watermark.tsx");
    expect(lines.join("\n")).toContain("canvasPlugins: [watermarkBundle],");
    expect(readdirSync(join(sourceDir, ".pi", "web"))).toEqual(before);
    expect(existsSync(join(sourceDir, ".pi", "web", "components"))).toBe(false);
  });

  it("拒绝路径:对 kind:\"plugin\" 包执行 add → source_not_component、非零退出(9.2)", async () => {
    const sourceDir = makeCleanSource("reject-agent");
    const lines: string[] = [];
    const code = await runAdd([PLUGIN_PACK, "--target", sourceDir], {
      cwd: tmp,
      write: (l) => lines.push(l),
    });
    expect(code).toBe(1);
    expect(existsSync(join(sourceDir, ".pi", "web", "components"))).toBe(false);
  });

  it("全程不修改仓库工作树(9.3)", () => {
    expect(gitStatus()).toBe(statusBefore);
  });
});

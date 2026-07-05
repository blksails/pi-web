/**
 * 不可见化与封装 grep 线固化(task 4.3;Req 7.5, 1.2, 1.3, 1.4)。
 *
 * 以静态源码断言把 4.2 审查用过的红线 grep 固化为测试:任何回潮
 * (builtin 里重新出现 DOM 事件 API / 视口数学、ui 深路径 import kernel、
 * canvas-kit 反向依赖 ui、index.ts 直出 kernel 内部件)都会红。
 *
 * ── 复杂性不可见化证明点清单(Req 7.5:每项 L1 复杂性 → L2 看不见它的证据)──
 * 1. 坐标换算(kernel/stage):工具回调拿到的坐标恒为底图像素坐标(Req 2.2)。
 *    证据:builtin/ 零 clientX/clientY/getBoundingClientRect/视口数学(本文件
 *    「builtin 零 DOM 事件 API」+「builtin 零视口数学」);换算纯函数行为锚在
 *    stage.test.ts。
 * 2. 指针路由(kernel/pointer):工具只接收语义化手势回调,不挂 DOM 监听、
 *    不打 stopPropagation 补丁(Req 3.1/3.3)。证据:builtin/ 零
 *    addEventListener/stopPropagation(本文件);分派行为锚在 pointer.test.ts。
 * 3. undo/redo 栈(kernel/history):工具只经 ctx.history.commit 提交操作,
 *    不自行维护栈(Req 4.2)。证据:builtin/ 无自建栈结构(本文件的
 *    window./globalThis/document. 线堵死栈外逃逸),行为锚在 history.test.ts。
 * 4. 指针捕获(capture):声明式 capturePointer 字段(如 text.ts 的
 *    capturePointer: false),内核代捕。证据:builtin/ 零
 *    setPointerCapture/releasePointerCapture(本文件)。
 * 5. 错误边界:L2 回调抛错由 ToolRuntime 捕获、禁用该工具、画布不崩
 *    (Req 6.4)。证据:tool-runtime.test.ts(runtime 行为测试)。
 * 6. semver 承诺面:L2 出口清单快照防漂移(Req 1.3/1.4)。证据:
 *    index-exports.test.ts(27 值快照)+ 本文件「index.ts 零 kernel 内部
 *    路径 re-export」(kernel-facade 是唯一收口门面)。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const canvasKitSrc = join(__dirname, "..", "src");
const builtinDir = join(canvasKitSrc, "builtin");
const uiPkg = join(__dirname, "..", "..", "ui");
const repoRoot = join(__dirname, "..", "..", "..");

/** 递归列出目录下全部 .ts/.tsx 源文件(绝对路径)。 */
function listSourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.(ts|tsx)$/.test(e.name))
    .map((e) => join(e.parentPath, e.name))
    .sort();
}

/** 逐行扫描一组文件,返回 `相对路径:行号: 行内容` 违例清单(空数组=绿)。 */
function grepFiles(files: string[], pattern: RegExp): string[] {
  const offenders: string[] = [];
  for (const file of files) {
    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (pattern.test(line)) {
        offenders.push(`${relative(repoRoot, file)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return offenders;
}

describe("不可见化与封装 grep 线(task 4.3)", () => {
  it("builtin/ 零 DOM 事件 API(getBoundingClientRect/stopPropagation/addEventListener/setPointerCapture/releasePointerCapture)— 指针路由与捕获归 kernel(Req 3.3/7.5)", () => {
    const files = listSourceFiles(builtinDir);
    expect(files.length).toBeGreaterThan(0);
    const offenders = grepFiles(
      files,
      /getBoundingClientRect|stopPropagation|addEventListener|setPointerCapture|releasePointerCapture/,
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("builtin/ 零视口数学(clientX/clientY/offsetX/offsetY/.scale/.offset/window./document./globalThis)— 坐标换算归 kernel/stage(Req 2.2/7.5)", () => {
    const files = listSourceFiles(builtinDir);
    // 现状全目录零命中(2026-07 固化),故按裸词从严;若未来出现合法命中,
    // 收窄正则并在此注释理由,勿整行删线。
    const offenders = grepFiles(
      files,
      /clientX|clientY|offsetX|offsetY|\.scale\b|\.offset\b|window\.|document\.|globalThis/,
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("ui(src+test)零 kernel 内部路径 import(深路径禁止;包名入口合法)(Req 1.3)", () => {
    const files = [
      ...listSourceFiles(join(uiPkg, "src")),
      ...listSourceFiles(join(uiPkg, "test")),
    ];
    expect(files.length).toBeGreaterThan(0);
    const offenders = grepFiles(
      files,
      /@blksails\/pi-web-canvas-kit\/src|canvas-kit\/src\/kernel|kernel-facade/,
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("canvas-kit src/ 零 @blksails/pi-web-ui(依赖方向:ui 消费 canvas-kit,反向禁止)(Req 1.2)", () => {
    const files = listSourceFiles(canvasKitSrc);
    expect(files.length).toBeGreaterThan(0);
    const offenders = grepFiles(files, /@blksails\/pi-web-ui/);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it('index.ts 零 kernel 内部路径 re-export(`from "./kernel/…"` 禁止;`./kernel-facade` 是收口门面,合法)(Req 1.3/1.4)', () => {
    const indexSrc = readFileSync(join(canvasKitSrc, "index.ts"), "utf8");
    const offenders = indexSrc
      .split("\n")
      .map((line, i) => ({ line, no: i + 1 }))
      .filter(({ line }) => /from\s+["']\.\/kernel\//.test(line))
      .map(({ line, no }) => `packages/canvas-kit/src/index.ts:${no}: ${line.trim()}`);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

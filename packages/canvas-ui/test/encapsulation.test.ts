/**
 * 封装线与 SES-H1 宿主中立静态断言(canvas-ui-m15 task 3.1;Req 4.1-4.4)。
 *
 * 照 canvas-kit test/encapsulation.test.ts 先例(readFileSync + 递归扫描 +
 * offenders 数组带 文件:行号:行内容;空目录守卫),把迁移后的四条红线固化:
 *
 * 1. canvas-ui 零 @blksails/pi-web-ui import(依赖方向:ui 经转发层消费本包,
 *    反向禁止;Req 4.2)。
 * 2. canvas-ui 对 canvas-kit 仅经包名入口(零深路径/零 kernel-facade;Req 4.2)。
 * 3. primitives 零 @blksails/* import(共享薄封装不依赖任何领域包;Req 4.3)。
 * 4. SES-H1 宿主中立线(Req 4.1):跨包 fs 读 packages/ui/src 全部文件(含
 *    styles.css),白名单 = src/canvas/ 转发模块目录;白名单外零领域词表命中。
 *    词表照 design「SES-H1 判据定义」节逐词形列举(`aigc` 单独不算——设置面板
 *    aigc 域属 config 领域)。
 *
 * 豁免锚协议(design 裁定,防无档扩散):
 * - 块级:`ses-h1-exempt: …` 开锚行起 … `ses-h1-exempt-end` 止锚行止(含两锚行
 *   自身,锚均为块注释形态)整段豁免——唯一用例 = ui index.ts 的 canvas 兼容导出块
 *   (块内是 `Canvas*` 导出标识符与 `./canvas/*.js` 白名单目录消费,一个大版本兼容承诺)。
 * - 单行:`ses-h1-exempt-next-line: …` 锚行豁免自身 + 紧随其后一行——
 *   唯一用例 = aigc-model-toggles-field 的 `../../canvas/aigc-model-meta.js`
 *   import 行(config 域对 canvas-ui 的合法跨包消费;说明符本身命中词表且改线
 *   无解,sanity F3 记档)。
 * - 锚总数硬线:非 `-end` 锚(按 `ses-h1-exempt` 子串、排除 `ses-h1-exempt-end`)
 *   全 packages/ui/src 恰为 2(index.ts 块 + toggles-field 行);新增豁免必红,
 *   逼迫记档改词表/白名单而非静默加锚。
 * - 结构守卫:未闭合块 / 孤儿 `-end` 都是违例(防豁免区间静默吞掉整个文件)。
 *
 * 正则收窄记档(先例注释纪律「误伤合法词收窄并注释理由」):
 * - 断言 1-3 的 import 线只认**带引号的模块说明符**(`"@blksails/…"`/`'@blksails/…'`),
 *   因 canvas-ui/primitives 的 index.ts 出口纪律注释里合法提及裸串
 *   `@blksails/pi-web-ui`、`@blksails/*`(散文,非 import);引号锚定后注释不误伤,
 *   而任何真实 import/re-export/require/动态 import 的说明符必带引号,线不漏。
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const canvasUiSrc = join(__dirname, "..", "src");
const primitivesSrc = join(__dirname, "..", "..", "primitives", "src");
const uiSrc = join(__dirname, "..", "..", "ui", "src");
const repoRoot = join(__dirname, "..", "..", "..");

/** 递归列出目录下全部文件(绝对路径;不限扩展名——SES-H1 线明确含 styles.css)。 */
function listAllFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
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

/**
 * SES-H1 领域词表(design「SES-H1 判据定义」节,逐词形列举、大小写敏感;
 * `aigc` 单独不算)。改词表 = 改 design,勿在此静默放宽。
 */
const SES_H1_WORDLIST =
  /canvas|Canvas|CANVAS|lineage|Lineage|workbench|Workbench|checkerboard|aigc-model-meta|aigc-quick-settings/;

const EXEMPT_END = "ses-h1-exempt-end";
const EXEMPT_NEXT_LINE = "ses-h1-exempt-next-line";
const EXEMPT = "ses-h1-exempt";

interface SesH1Scan {
  readonly offenders: string[];
  /** 非 `-end` 豁免锚计数(块级开锚 + 单行锚;`-end` 不计)。 */
  readonly anchorCount: number;
}

/** 对单文件做带豁免锚协议的词表扫描(协议见文件头注释)。 */
function scanSesH1File(file: string): SesH1Scan {
  const offenders: string[] = [];
  let anchorCount = 0;
  const rel = relative(repoRoot, file);
  const lines = readFileSync(file, "utf8").split("\n");
  let inBlock = false;
  let skipNext = false;
  lines.forEach((line, i) => {
    const loc = `${rel}:${i + 1}`;
    if (line.includes(EXEMPT_END)) {
      if (!inBlock) offenders.push(`${loc}: 孤儿 ${EXEMPT_END}(无对应开锚): ${line.trim()}`);
      inBlock = false;
      return;
    }
    if (line.includes(EXEMPT_NEXT_LINE)) {
      anchorCount += 1;
      skipNext = true;
      return;
    }
    if (line.includes(EXEMPT)) {
      anchorCount += 1;
      inBlock = true;
      return;
    }
    if (inBlock) return;
    if (skipNext) {
      skipNext = false;
      return;
    }
    if (SES_H1_WORDLIST.test(line)) {
      offenders.push(`${loc}: ${line.trim()}`);
    }
  });
  if (inBlock) {
    offenders.push(`${rel}: ses-h1-exempt 块未闭合(缺 ${EXEMPT_END},豁免区间吞到 EOF)`);
  }
  return { offenders, anchorCount };
}

describe("封装静态断言(task 3.1;Req 4.2/4.3)", () => {
  it('canvas-ui src/ 零 @blksails/pi-web-ui import(依赖方向:ui 消费 canvas-ui,反向禁止)(Req 4.2)', () => {
    const files = listAllFiles(canvasUiSrc);
    expect(files.length).toBeGreaterThan(0);
    // 引号锚定说明符,不误伤 index.ts 出口纪律注释里的裸串提及(收窄记档见文件头)。
    // @blksails/pi-web-canvas-ui 前缀不同不在射程内。
    const offenders = grepFiles(files, /["'`]@blksails\/pi-web-ui(\/[^"'`]*)?["'`]/);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("canvas-ui src/ 消费 canvas-kit 仅经包名入口(零深路径/零 kernel-facade)(Req 4.2)", () => {
    const files = listAllFiles(canvasUiSrc);
    expect(files.length).toBeGreaterThan(0);
    const offenders = grepFiles(files, /["'`]@blksails\/pi-web-canvas-kit\/|kernel-facade/);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("primitives src/ 零 @blksails/* import(共享薄封装零工作区依赖)(Req 4.3)", () => {
    const files = listAllFiles(primitivesSrc);
    expect(files.length).toBeGreaterThan(0);
    // 引号锚定说明符:primitives index.ts 出口纪律注释合法提及 `@blksails/*`(散文)。
    const offenders = grepFiles(files, /["'`]@blksails\//);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});

describe("SES-H1 宿主中立线(task 3.1;Req 4.1)", () => {
  it("packages/ui/src 白名单(src/canvas/)外全部文件零领域词表命中(豁免锚区间除外)", () => {
    const all = listAllFiles(uiSrc);
    expect(all.length).toBeGreaterThan(0);
    const whitelisted = all.filter((f) => relative(uiSrc, f).startsWith(`canvas${sep}`));
    const scanned = all.filter((f) => !relative(uiSrc, f).startsWith(`canvas${sep}`));
    // 白名单目录守卫:转发模块目录存在且非空(空了说明扫描根接错,线形同虚设)。
    expect(whitelisted.length).toBeGreaterThan(0);
    expect(scanned.length).toBeGreaterThan(0);
    // 样式文件明确在射程内(design:白名单外全部文件**含 styles.css**)。
    expect(scanned.some((f) => f.endsWith("styles.css"))).toBe(true);
    const offenders = scanned.flatMap((f) => scanSesH1File(f).offenders);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("豁免锚总数恰为 2(index.ts canvas 兼容导出块 + toggles-field import 行;防无档扩散)", () => {
    // 全 packages/ui/src 计数(含白名单目录——锚只该出现在记档的两处,白名单内也不该有)。
    const all = listAllFiles(uiSrc);
    const anchorCount = all.reduce((n, f) => n + scanSesH1File(f).anchorCount, 0);
    expect(anchorCount).toBe(2);
    // 锚落点锚定(位置漂移=记档失真,同样红):
    const indexScan = scanSesH1File(join(uiSrc, "index.ts"));
    expect(indexScan.anchorCount).toBe(1);
    const togglesScan = scanSesH1File(join(uiSrc, "config", "fields", "aigc-model-toggles-field.tsx"));
    expect(togglesScan.anchorCount).toBe(1);
  });
});

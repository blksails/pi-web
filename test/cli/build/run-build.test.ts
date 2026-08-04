// @vitest-environment node
/**
 * `runBuild` 单测(spec cli-agent-build,任务 3.8,Req 1.5, 5.3, 5.4, 7.2, 7.3, 7.4)。
 *
 * 本文件只覆盖**编排层自身**的职责——3.1–3.7 各阶段模块的内部行为已由各自单测覆盖
 * (`agent-source.test.ts`/`toolchain.test.ts`/`pane-discovery.test.ts`/`pane-build.test.ts`/
 * `panes-manifest.test.ts`/`react-singleton.test.ts`/`isolated-entry.test.ts`);全量端到端
 * 断言(产物集合完整性、无 pane 分支、覆盖语义三条回归线)属于任务 7.2 的
 * `test/cli/build/integration.test.ts`,不在此重复。
 *
 * 覆盖:
 *  - 成功路径产出全部预期文件(webext + 隔离入口 + 分派入口,`manifest.entry` 指向分派入口
 *    且校验值与其最终字节一致),并经 `reporter.complete` 输出文件清单与完整性(7.4)。
 *  - `--sign` 语义:manifest 携带可独立验签的 Ed25519 签名,覆盖的是**分派入口改写后**的
 *    最终字节而非 `buildWebExtension` 直出的原始字节(1.5,判别力核心)。
 *  - 5.3/5.4:重新构建以当前版本整体覆盖产物目录,不残留更早版本(或伪造)产出的过时文件。
 *  - 7.2/7.3:任一阶段失败经统一的 `reporter.fail()` 通道呈现、返回非零码,且敏感值(webext
 *    入口打包失败信息里携带的凭据样式字符串)被脱敏;同时验证失败前已写出的部分产物
 *    (pane 双形态文件)不残留(完成态用语)。
 *
 * 全程用真实临时目录 + 真实工具链(esbuild/postcss/tailwindcss 取自本仓库根 `node_modules`,
 * 样式预设取本仓库 `packages/ui/tailwind-preset.ts`)+ 真实 jiti 求值 pane 声明——与本 spec
 * 其余模块单测(`pane-build.test.ts`/`isolated-entry.test.ts`)一致的「不 mock 打包器」策略,
 * 因为本文件恰恰要验证的是「各阶段被正确接线在一起」,用桩替身会绕过这条判别力核心。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { webcrypto, createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { runBuild } from "@/server/cli/build/index";
import { createProgressReporter, type CliError } from "@/server/cli/reporter";
import { canonicalManifestBytes, type WebExtensionManifest } from "@blksails/pi-web-protocol";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** 真实工具链候选(本仓库根本身满足全部四项,任务 1.3 已提为运行依赖)。 */
const TOOLCHAIN_ROOT_CANDIDATES = [join(REPO_ROOT, "node_modules")];
/** 真实样式预设候选(本仓库 `packages/ui/tailwind-preset.ts`,任务 1.4 已开出口)。 */
const STYLE_PRESET_CANDIDATES = [join(REPO_ROOT, "packages", "ui", "tailwind-preset.ts")];

let root: string;
let sourceRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "run-build-test-"));
  sourceRoot = join(root, "agent");
  mkdirSync(sourceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 落一份最简 webext 入口(`.pi/web` 约定,无 react 依赖,esbuild 可直接打包)。 */
function seedWebextEntry(marker: string): void {
  const entryDir = join(sourceRoot, ".pi", "web");
  mkdirSync(entryDir, { recursive: true });
  writeFileSync(join(entryDir, "web.config.ts"), `export default { marker: ${JSON.stringify(marker)} };\n`);
}

/** 落一份会让 esbuild 打包失败、且失败信息里携带凭据样式字符串的 webext 入口(7.3 判别力核心)。 */
const LEAKED_TOKEN = "sk-th1s1ss3cr3ttoken1234567890";
function seedBrokenWebextEntry(): void {
  const entryDir = join(sourceRoot, ".pi", "web");
  mkdirSync(entryDir, { recursive: true });
  // esbuild 对无法解析的裸说明符,会把说明符原文写进 "Could not resolve ..." 错误信息——
  // 借此让一个形似凭据的字符串(sk- 前缀,redactSecrets 第 4 类模式)真实出现在错误链路里,
  // 而不是在测试里手工拼一段假错误文案。
  writeFileSync(join(entryDir, "web.config.ts"), `import ${JSON.stringify(LEAKED_TOKEN)};\nexport default {};\n`);
}

const VALID_CAPABILITIES = {
  routes: [],
  surfaceKeys: [],
  surfaceCommands: [],
  attachments: "none",
  conversation: "none",
  downloads: false,
  events: { publish: [], subscribe: [] },
  state: { read: [], write: [] },
};

/** 落一份包根汇总 pane 声明(`panes/modules.ts`)+ 一个非画布 pane 的最简入口。 */
function seedPaneDeclaration(id: string): void {
  const panesDir = join(sourceRoot, "panes");
  mkdirSync(panesDir, { recursive: true });
  writeFileSync(
    join(panesDir, `${id}-entry.ts`),
    `const root = document.getElementById("root");\nif (root) root.textContent = ${JSON.stringify(`ready-${id}`)};\nexport {};\n`,
  );
  writeFileSync(
    join(panesDir, "modules.ts"),
    [
      "export default {",
      `  id: "test-panes",`,
      "  modules: [",
      "    {",
      `      id: ${JSON.stringify(id)},`,
      `      title: ${JSON.stringify(id)},`,
      `      entry: "./${id}-entry.ts",`,
      `      capabilities: ${JSON.stringify(VALID_CAPABILITIES)},`,
      "    },",
      "  ],",
      "};",
    ].join("\n"),
  );
}

function outDirOf(): string {
  return join(sourceRoot, ".pi", "web", "dist");
}

function capturingReporter(): { reporter: ReturnType<typeof createProgressReporter>; lines: string[] } {
  const lines: string[] = [];
  return { reporter: createProgressReporter({ write: (line) => lines.push(line) }), lines };
}

function readManifest(outDir: string): WebExtensionManifest {
  return JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")) as WebExtensionManifest;
}

/** 与 `manifest-emit.ts#computeIntegrity`/`isolated-entry.ts#recomputeIntegrity` 同一算法的独立复算。 */
function independentSha384(bytes: string): string {
  return `sha384-${createHash("sha384").update(bytes, "utf8").digest("base64")}`;
}

describe("runBuild: 成功路径(Req 7.4)", () => {
  it("产出全部预期文件;manifest.entry 指向分派入口且校验值与其最终字节逐字节一致", async () => {
    seedWebextEntry("hello");
    const { reporter, lines } = capturingReporter();

    const exitCode = await runBuild(
      [],
      {
        cwd: sourceRoot,
        toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES,
        stylePresetCandidates: STYLE_PRESET_CANDIDATES,
      },
      reporter,
    );

    expect(exitCode).toBe(0);
    const outDir = outDirOf();

    // 双入口 + 统一分派入口 + manifest,均写盘。
    expect(existsSync(join(outDir, "web-extension.mjs"))).toBe(true); // 分派入口(取代原名)
    expect(existsSync(join(outDir, "web-extension.same-origin.mjs"))).toBe(true); // 原同源产物改名
    expect(existsSync(join(outDir, "isolated-entry.mjs"))).toBe(true);
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
    // 无 pane 声明:不产 panes.json(3.3 纪律,由 pane-discovery 自身保证,这里只断言编排层
    // 未凭空产出该文件)。
    expect(existsSync(join(outDir, "panes.json"))).toBe(false);

    const manifest = readManifest(outDir);
    expect(manifest.entry).toBe("web-extension.mjs");
    const dispatcherBytes = readFileSync(join(outDir, "web-extension.mjs"), "utf8");
    expect(manifest.integrity).toBe(independentSha384(dispatcherBytes));
    // 未指定 --sign:不应产出签名。
    expect(manifest.signature).toBeUndefined();

    // 7.4:成功经 reporter.complete 输出文件清单与关键完整性校验值(不直接 console.log)。
    const completeLine = lines.find((l) => l.startsWith("✔ build"));
    expect(completeLine).toBeDefined();
    expect(completeLine).toContain("web-extension.mjs");
    expect(completeLine).toContain("isolated-entry.mjs");
    expect(completeLine).toContain(manifest.integrity!);
    // 全程未直接调用 console.log 拼错误/成功文案——唯一出口是 reporter,这里用「捕获到的行
    // 数与阶段」间接验证(design.md Invariants)。
    expect(lines.some((l) => l.startsWith("✖"))).toBe(false);
  });
});

describe("runBuild: --sign 保留既有签名语义(Req 1.5)", () => {
  it("manifest 携带的签名可用对应公钥独立验签,且覆盖分派入口改写后的最终字节", async () => {
    seedWebextEntry("signed");
    const keyPair = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const privateKeyB64 = Buffer.from(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey)).toString("base64");
    const publicKeyRaw = await webcrypto.subtle.exportKey("raw", keyPair.publicKey);

    const { reporter } = capturingReporter();
    const exitCode = await runBuild(
      ["--sign", privateKeyB64],
      {
        cwd: sourceRoot,
        toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES,
        stylePresetCandidates: STYLE_PRESET_CANDIDATES,
      },
      reporter,
    );

    expect(exitCode).toBe(0);
    const outDir = outDirOf();
    const manifest = readManifest(outDir);
    expect(manifest.signature).toBeDefined();

    // 独立验签(不复用被测代码的签名逻辑):签名必须覆盖「entry 已指向分派入口、integrity
    // 已是分派入口最终字节」之后的 manifest 字节——若实现在改写 entry/integrity 前就签名
    // (即签了 buildWebExtension 的原始输出),这里会验签失败。
    const signature = manifest.signature;
    const base: Omit<WebExtensionManifest, "signature"> = {
      id: manifest.id,
      targetApiVersion: manifest.targetApiVersion,
      entry: manifest.entry,
      integrity: manifest.integrity,
      ...(manifest.css !== undefined ? { css: manifest.css } : {}),
      ...(manifest.capabilities !== undefined ? { capabilities: manifest.capabilities } : {}),
    };
    const data = new TextEncoder().encode(canonicalManifestBytes(base));
    const verified = await webcrypto.subtle.verify(
      { name: "Ed25519" },
      await webcrypto.subtle.importKey("raw", publicKeyRaw, { name: "Ed25519" }, false, ["verify"]),
      Buffer.from(signature!, "base64"),
      data,
    );
    expect(verified).toBe(true);

    // 判别力:篡改 integrity 后同一签名必须验签失败(证明签名确实覆盖了该字段,不是摆设)。
    const tampered: Omit<WebExtensionManifest, "signature"> = { ...base, integrity: "sha384-tampered" };
    const tamperedData = new TextEncoder().encode(canonicalManifestBytes(tampered));
    const tamperedVerified = await webcrypto.subtle.verify(
      { name: "Ed25519" },
      await webcrypto.subtle.importKey("raw", publicKeyRaw, { name: "Ed25519" }, false, ["verify"]),
      Buffer.from(signature!, "base64"),
      tamperedData,
    );
    expect(tamperedVerified).toBe(false);
  });
});

describe("runBuild: 覆盖而非增量(Req 5.3, 5.4)", () => {
  it("重新构建以当前版本整体覆盖,伪造的旧产物文件不残留", async () => {
    seedWebextEntry("v1");
    const first = capturingReporter();
    const firstExit = await runBuild(
      [],
      { cwd: sourceRoot, toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES, stylePresetCandidates: STYLE_PRESET_CANDIDATES },
      first.reporter,
    );
    expect(firstExit).toBe(0);

    const outDir = outDirOf();
    // 塞入一份伪造的、仅由「更早版本」产出的过时文件。
    const staleFile = join(outDir, "pane-long-removed.js");
    writeFileSync(staleFile, "// stale artifact from an earlier version\n");
    expect(existsSync(staleFile)).toBe(true);

    const second = capturingReporter();
    const secondExit = await runBuild(
      [],
      { cwd: sourceRoot, toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES, stylePresetCandidates: STYLE_PRESET_CANDIDATES },
      second.reporter,
    );
    expect(secondExit).toBe(0);

    expect(existsSync(staleFile)).toBe(false);
    // 当前版本的产物仍然完整存在。
    expect(existsSync(join(outDir, "web-extension.mjs"))).toBe(true);
    expect(existsSync(join(outDir, "manifest.json"))).toBe(true);
  });
});

describe("runBuild: 失败即止 · 统一通道 · 脱敏 · 不残留部分产物(Req 7.2, 7.3)", () => {
  it("webext 阶段失败:非零退出、经 reporter.fail 呈现且脱敏、此前写出的 pane 产物不残留", async () => {
    seedBrokenWebextEntry();
    seedPaneDeclaration("alpha");
    const { reporter, lines } = capturingReporter();

    const exitCode = await runBuild(
      [],
      { cwd: sourceRoot, toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES, stylePresetCandidates: STYLE_PRESET_CANDIDATES },
      reporter,
    );

    expect(exitCode).toBe(1);

    const outDir = outDirOf();
    // 不残留部分产物:pane 阶段本应先于 webext 成功并写出 pane-alpha.{js,html} + panes.json,
    // 但 webext 阶段失败后编排层必须清空整个产物目录——outDir 不再存在任何文件。
    expect(existsSync(join(outDir, "pane-alpha.js"))).toBe(false);
    expect(existsSync(join(outDir, "panes.json"))).toBe(false);
    expect(existsSync(outDir)).toBe(false);

    // 统一通道:全部错误经 reporter.fail 呈现(不直接 console.log),恰好一条失败记录。
    const failLines = lines.filter((l) => l.startsWith("✖"));
    expect(failLines).toHaveLength(1);
    expect(failLines[0]).toContain("build");

    // 脱敏(7.3):webext 打包失败信息里原本会携带的凭据样式字符串必须被抹除,原文不得出现
    // 在任何一条捕获到的输出行里。
    expect(lines.join("\n")).not.toContain(LEAKED_TOKEN);
    expect(failLines[0]).toContain("[redacted]");
  });

  it("resolve 阶段失败(无可识别 webext 源):非零退出,不触碰任何文件系统(无 outDir 可谈)", async () => {
    // sourceRoot 里既没有 .pi/web 也没有 web/。
    const { reporter, lines } = capturingReporter();

    const exitCode = await runBuild(
      [],
      { cwd: sourceRoot, toolchainRootCandidates: TOOLCHAIN_ROOT_CANDIDATES, stylePresetCandidates: STYLE_PRESET_CANDIDATES },
      reporter,
    );

    expect(exitCode).toBe(1);
    const failLines = lines.filter((l) => l.startsWith("✖"));
    expect(failLines).toHaveLength(1);
    expect(failLines[0]).toContain("BUILD_RESOLVE_SOURCE_NOT_FOUND");
    // resolve 阶段发生在产物目录路径确定之前,不应有任何目录被创建。
    expect(existsSync(join(sourceRoot, ".pi"))).toBe(false);
  });

  it("toolchain 阶段失败(候选路径全缺失):不破坏此前已存在的产物目录内容", async () => {
    seedWebextEntry("existing-good-build");
    const outDir = outDirOf();
    mkdirSync(outDir, { recursive: true });
    const preexisting = join(outDir, "web-extension.mjs");
    writeFileSync(preexisting, "// pretend this is a previously successful build\n");

    const { reporter, lines } = capturingReporter();
    const exitCode = await runBuild(
      [],
      // 候选路径故意留空 —— 工具链与样式预设均不可解析。
      { cwd: sourceRoot, toolchainRootCandidates: [], stylePresetCandidates: [] },
      reporter,
    );

    expect(exitCode).toBe(1);
    const failLines = lines.filter((l) => l.startsWith("✖"));
    expect(failLines).toHaveLength(1);
    expect(failLines[0]).toContain("BUILD_TOOLCHAIN_MISSING");
    // toolchain 预检失败发生在「清空产物目录」之前(见 index.ts 头注设计取舍):此前已存在
    // 的(假定可用的)产物不应被这次可恢复的预检失败破坏。
    expect(existsSync(preexisting)).toBe(true);
  });
});

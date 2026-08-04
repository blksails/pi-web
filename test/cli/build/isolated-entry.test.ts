// @vitest-environment node
/**
 * `isolated-entry` 单测(spec cli-agent-build,任务 3.7,Req 2.4, 2.5)。
 *
 * 覆盖:
 *  - `resolveDispatchTarget` 以可注入的探测桩替代真实宿主,两种探测结果分别解析到自包含
 *    产物与同源产物(Req 2.4)。
 *  - `detectHostForm`(生产实现)确实读取运行时全局标记,而非硬编码——用真实
 *    `globalThis[HOST_FORM_GLOBAL_FLAG]` 赋值驱动两种分支(与 `resolveDispatchTarget` 的
 *    纯函数覆盖互补:一个证明「探测桩可替换」,一个证明「缺省探测桩确实读那个标记」)。
 *  - `buildIsolatedEntry` 真实 esbuild 打包一个「agent 与宿主各自安装一份 react」的入口,
 *    证明产物自包含且收敛到 agent source 根单一副本(与 `react-singleton.test.ts`/
 *    `pane-build.test.ts` 同策略,不 mock 打包器)。
 *  - `buildDispatcher` 写出的字节与其 `integrity` 逐字节一致;字节被(模拟)改写后,
 *    旧 `integrity` 不再匹配新字节,必须重新调用 `recomputeIntegrity` 才能同步(Req 2.5,
 *    判别力来自「旧校验值在新字节下失配」这一负面断言,不止是「算出来的值格式对」)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  buildDispatcher,
  buildIsolatedEntry,
  detectHostForm,
  recomputeIntegrity,
  renderDispatcherSource,
  resolveDispatchTarget,
  HOST_FORM_GLOBAL_FLAG,
  type DispatchTargets,
} from "@/server/cli/build/isolated-entry";
import { BuildError } from "@/server/cli/build/errors";
import { findSingletonOccurrences } from "@/packages/web-kit/build/externals-guard";

/** 与 `manifest-emit.ts#computeIntegrity` 同一算法的独立复算,供交叉验证不依赖被测函数自身。 */
function independentSha384(bytes: string): string {
  return `sha384-${createHash("sha384").update(bytes, "utf8").digest("base64")}`;
}

const targets: DispatchTargets = {
  isolatedEntry: "isolated-entry.mjs",
  sameOriginEntry: "web-extension.mjs",
};

describe("resolveDispatchTarget: 可注入探测桩(Req 2.4)", () => {
  it("探测结果为 isolated 时解析到自包含产物", () => {
    expect(resolveDispatchTarget(targets, () => "isolated")).toBe(targets.isolatedEntry);
  });

  it("探测结果为 same-origin 时解析到同源产物", () => {
    expect(resolveDispatchTarget(targets, () => "same-origin")).toBe(targets.sameOriginEntry);
  });

  it("缺省探测桩为 detectHostForm(不显式传入 probe 时)", () => {
    delete (globalThis as Record<string, unknown>)[HOST_FORM_GLOBAL_FLAG];
    expect(resolveDispatchTarget(targets)).toBe(targets.sameOriginEntry);
  });
});

describe("detectHostForm: 真实探测读取运行时全局标记(Req 2.4)", () => {
  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[HOST_FORM_GLOBAL_FLAG];
  });

  it("全局标记未注入(同全部既有宿主):回落 same-origin", () => {
    delete (globalThis as Record<string, unknown>)[HOST_FORM_GLOBAL_FLAG];
    expect(detectHostForm()).toBe("same-origin");
  });

  it("全局标记为 true(隔离宿主约定):判定为 isolated", () => {
    (globalThis as Record<string, unknown>)[HOST_FORM_GLOBAL_FLAG] = true;
    expect(detectHostForm()).toBe("isolated");
  });

  it("全局标记为真值但非严格 true:仍回落 same-origin(约定要求严格 true,不接受一般 truthy)", () => {
    (globalThis as Record<string, unknown>)[HOST_FORM_GLOBAL_FLAG] = "yes";
    expect(detectHostForm()).toBe("same-origin");
  });
});

describe("renderDispatcherSource: 生成的源码嵌入两个分派目标(Req 2.4)", () => {
  it("包含全局标记名与两个目标路径的字面量", () => {
    const source = renderDispatcherSource(targets);
    expect(source).toContain(JSON.stringify(HOST_FORM_GLOBAL_FLAG));
    // ★ 必须断言**相对说明符**而非仅「文件名出现过」。裸说明符会被任何 ESM 解析器
    // 当作包名，产物一加载就 ERR_MODULE_NOT_FOUND —— 而只断言文件名的旧写法对这条
    // 缺陷零判别力（它确实曾放过一次真实 bug）。
    expect(source).toContain(JSON.stringify(`./${targets.isolatedEntry}`));
    expect(source).toContain(JSON.stringify(`./${targets.sameOriginEntry}`));
  });

  it("两个分派目标都不是裸说明符（回归守卫）", () => {
    const source = renderDispatcherSource(targets);
    // 取出 import() 里的所有字符串字面量，逐个要求以 ./ 或 ../ 开头。
    const specifiers = [...source.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => m[1] ?? "")
      .filter((s) => s.endsWith(".mjs"));
    expect(specifiers.length).toBeGreaterThan(0);
    for (const s of specifiers) {
      expect(s).toMatch(/^\.\.?\//);
    }
  });
});

describe("recomputeIntegrity", () => {
  it("格式为 sha384-<base64>,且与独立复算一致", () => {
    const value = recomputeIntegrity("hello");
    expect(value).toMatch(/^sha384-[A-Za-z0-9+/]+=*$/);
    expect(value).toBe(independentSha384("hello"));
  });

  it("不同字节产出不同校验值(判别力:不是恒定值)", () => {
    expect(recomputeIntegrity("a")).not.toBe(recomputeIntegrity("b"));
  });
});

let root: string;
let sourceRoot: string;
let outDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "isolated-entry-test-"));
  sourceRoot = join(root, "source");
  outDir = join(root, "dist");
  mkdirSync(sourceRoot, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 造一份可被 esbuild 识别为 CJS 的最小 react/react-dom 安装(与 react-singleton.test.ts 同策略)。 */
function seedRuntimeCopy(installRoot: string, pkgName: string, flavor: string): void {
  const pkgDir = join(installRoot, "node_modules", pkgName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: pkgName, version: "1.0.0", main: "index.js" }));
  writeFileSync(join(pkgDir, "index.js"), `module.exports = { flavor: ${JSON.stringify(flavor)} };\n`);
}

describe("buildIsolatedEntry: 自包含产物(Req 2.4)", () => {
  it("react/react-dom 被内联且收敛到 agent source 根的单一副本,不依赖宿主 import map", async () => {
    const hostRoot = join(root, "host");
    mkdirSync(hostRoot, { recursive: true });
    seedRuntimeCopy(sourceRoot, "react", "agent");
    seedRuntimeCopy(sourceRoot, "react-dom", "agent");
    seedRuntimeCopy(hostRoot, "react", "host");
    seedRuntimeCopy(hostRoot, "react-dom", "host");
    writeFileSync(
      join(hostRoot, "host-module.js"),
      [
        `import React from "react";`,
        `import ReactDOM from "react-dom";`,
        `export function hostRuntime(){ return { React, ReactDOM }; }`,
      ].join("\n"),
    );
    const entry = join(sourceRoot, "web.config.ts");
    writeFileSync(
      entry,
      [
        `import React from "react";`,
        `import ReactDOM from "react-dom";`,
        `import { hostRuntime } from "../host/host-module.js";`,
        `export default { React, ReactDOM, hostRuntime };`,
      ].join("\n"),
    );

    const artifact = await buildIsolatedEntry({ entry, sourceRoot, outDir });

    expect(artifact.fileName).toBe("isolated-entry.mjs");
    expect(existsSync(artifact.path)).toBe(true);
    const written = readFileSync(artifact.path, "utf8");
    expect(written).toBe(artifact.code);

    // 自包含:react/react-dom 恰好一份,且收敛到 agent source 根(不是宿主根)。
    const reactRoots = findSingletonOccurrences(artifact.code, "react");
    const reactDomRoots = findSingletonOccurrences(artifact.code, "react-dom");
    expect(reactRoots).toHaveLength(1);
    expect(reactDomRoots).toHaveLength(1);
    expect(reactRoots[0]).toContain(join(sourceRoot, "node_modules", "react"));
    expect(reactRoots[0]).not.toContain(hostRoot);

    // integrity 与写出的最终字节逐字节一致。
    expect(artifact.integrity).toBe(recomputeIntegrity(written));
    expect(artifact.integrity).toBe(independentSha384(written));
  });

  it("入口打包失败包装为 BuildError(stage:isolated),携带入口路径", async () => {
    const entry = join(sourceRoot, "broken.ts");
    writeFileSync(entry, `import x from "definitely-not-installed-anywhere";\nexport default x;\n`);

    try {
      await buildIsolatedEntry({ entry, sourceRoot, outDir });
      expect.unreachable("应抛出 BuildError");
    } catch (e) {
      expect(e).toBeInstanceOf(BuildError);
      expect((e as BuildError).stage).toBe("isolated");
      expect((e as BuildError).code).toBe("BUILD_ISOLATED_BUNDLE_FAILED");
      expect((e as BuildError).path).toBe(entry);
    }
  });
});

describe("buildDispatcher: 统一入口写盘 + 完整性重算(Req 2.4, 2.5)", () => {
  it("写出的文件字节与返回的 code 一致,integrity 与最终字节逐字节一致", async () => {
    const result = await buildDispatcher({ ...targets, outDir });

    expect(result.fileName).toBe("web-extension.mjs");
    expect(existsSync(result.path)).toBe(true);
    const written = readFileSync(result.path, "utf8");
    expect(written).toBe(result.code);
    expect(result.integrity).toBe(recomputeIntegrity(written));
    expect(result.integrity).toBe(independentSha384(written));
  });

  it("dispatcher 的分派逻辑经 resolveDispatchTarget 复算与写出的目标路径一致(自证:两者共享同一约定)", async () => {
    const result = await buildDispatcher({ ...targets, outDir });
    expect(result.code).toContain(JSON.stringify(`./${targets.isolatedEntry}`));
    expect(result.code).toContain(JSON.stringify(`./${targets.sameOriginEntry}`));
    expect(resolveDispatchTarget(targets, () => "isolated")).toBe(targets.isolatedEntry);
    expect(resolveDispatchTarget(targets, () => "same-origin")).toBe(targets.sameOriginEntry);
  });

  it("Req 2.5:字节被改写后旧 integrity 不再匹配,必须重新调用 recomputeIntegrity 才能同步", async () => {
    const first = await buildDispatcher({ ...targets, outDir });

    // 模拟 runBuild 编排层在写出后按最终产物文件名回填分派目标、重新落盘(design.md 流程步 10
    // 的「改写」场景)——用不同的 targets 重建一次,产出的字节必然不同。
    const rewrittenTargets: DispatchTargets = {
      isolatedEntry: "isolated-entry.abcd1234.mjs",
      sameOriginEntry: "web-extension.abcd1234.mjs",
    };
    const second = await buildDispatcher({ ...rewrittenTargets, outDir });
    const secondBytes = readFileSync(second.path, "utf8");

    expect(second.code).not.toBe(first.code);
    // 判别力核心:旧 integrity 对新字节是错的,不能拿旧值顶替。
    expect(first.integrity).not.toBe(second.integrity);
    expect(first.integrity).not.toBe(recomputeIntegrity(secondBytes));
    // 重新调用 recomputeIntegrity 后,与最终(改写后)字节逐字节一致。
    expect(second.integrity).toBe(recomputeIntegrity(secondBytes));
    expect(second.integrity).toBe(independentSha384(secondBytes));
  });
});

// @vitest-environment node
/**
 * `createReactSingletonPlugin` 单测(spec cli-agent-build,任务 3.4,Req 4.3)。
 *
 * 构造「agent source 与宿主各自安装一份 react/react-dom」的真实临时目录(与
 * `test/cli/build/agent-source.test.ts` 同策略,不 mock 文件系统),用真实 esbuild 打包一个
 * 从 agent 入口引入「宿主侧代码」的 pane 入口:
 *   - 不加插件:两份物理副本各自被打进产物(复现问题,作为对照)。
 *   - 加插件:全部解析收敛到 agent source 根,产物中恰好一份——用 2.2 的
 *     `assertSingletonOccursOnce` / `findSingletonOccurrences` 判定,且不区分是通过一次
 *     esbuild 内部去重还是插件强制改写实现的。
 *
 * 判别力来源:两个副本内容不同(`copy: "agent"` vs `copy: "host"`),因此「插件生效」与
 * 「测试夹具没搭对导致 esbuild 本就只解析到一份」不会混淆——基线用例先证明 2 份是可复现的。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import {
  assertSingletonOccursOnce,
  findSingletonOccurrences,
} from "@/packages/web-kit/build/externals-guard";
import { createReactSingletonPlugin } from "@/server/cli/build/react-singleton";

let root: string;
let agentRoot: string;
let hostRoot: string;

/** 造一份可被 esbuild 识别为 CJS(module.exports)的最小 react/react-dom 安装。 */
function seedRuntimeCopy(installRoot: string, pkgName: string, flavor: string): void {
  const pkgDir = join(installRoot, "node_modules", pkgName);
  mkdirSync(pkgDir, { recursive: true });
  writeFileSync(
    join(pkgDir, "package.json"),
    JSON.stringify({ name: pkgName, version: "1.0.0", main: "index.js" }),
  );
  writeFileSync(join(pkgDir, "index.js"), `module.exports = { flavor: ${JSON.stringify(flavor)} };\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "react-singleton-test-"));
  agentRoot = join(root, "agent");
  hostRoot = join(root, "host");
  mkdirSync(agentRoot, { recursive: true });
  mkdirSync(hostRoot, { recursive: true });

  // agent source 自带一份 react/react-dom。
  seedRuntimeCopy(agentRoot, "react", "agent");
  seedRuntimeCopy(agentRoot, "react-dom", "agent");
  // 宿主(模拟 pi-web 自身)也各自装了一份——物理上是不同副本。
  seedRuntimeCopy(hostRoot, "react", "host");
  seedRuntimeCopy(hostRoot, "react-dom", "host");

  // 宿主侧代码(如被打包进来的 @blksails/pi-web-canvas-ui 组件):按自身文件位置解析,
  // 天然会拿到宿主的副本——用于复现「入口拿 agent 副本,依赖拿宿主副本」的分裂场景。
  writeFileSync(
    join(hostRoot, "host-module.js"),
    [
      `import React from "react";`,
      `import ReactDOM from "react-dom";`,
      `export function hostRuntime(){ return { React, ReactDOM }; }`,
    ].join("\n"),
  );

  // agent 入口:直接 import react/react-dom,并引入上面的宿主侧代码。
  writeFileSync(
    join(agentRoot, "entry.js"),
    [
      `import React from "react";`,
      `import ReactDOM from "react-dom";`,
      `import { hostRuntime } from "../host/host-module.js";`,
      `export default { React, ReactDOM, hostRuntime };`,
    ].join("\n"),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function bundleAgentEntry(plugins: ReturnType<typeof createReactSingletonPlugin>[] = []): Promise<string> {
  const result = await build({
    entryPoints: [join(agentRoot, "entry.js")],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    plugins,
  });
  const output = result.outputFiles?.[0];
  if (output === undefined) throw new Error("esbuild 未产出文件");
  return output.text;
}

describe("createReactSingletonPlugin", () => {
  it("基线(无插件):agent 与宿主各自的副本都被打进产物,恰好一份的断言失败", async () => {
    const code = await bundleAgentEntry();
    expect(findSingletonOccurrences(code, "react")).toHaveLength(2);
    expect(findSingletonOccurrences(code, "react-dom")).toHaveLength(2);
    expect(() => assertSingletonOccursOnce(code, "react")).toThrow(/2 份/);
  });

  it("加插件:全部解析收敛到 agent source 根,react/react-dom 各恰好一份", async () => {
    const plugin = createReactSingletonPlugin(agentRoot);
    const code = await bundleAgentEntry([plugin]);

    const reactRoots = findSingletonOccurrences(code, "react");
    const reactDomRoots = findSingletonOccurrences(code, "react-dom");
    expect(reactRoots).toHaveLength(1);
    expect(reactDomRoots).toHaveLength(1);
    expect(() => assertSingletonOccursOnce(code, "react")).not.toThrow();
    expect(() => assertSingletonOccursOnce(code, "react-dom")).not.toThrow();

    // 解析基准确实是 agent source 根,不是宿主根(方向性断言:research.md R-5)。
    expect(reactRoots[0]).toContain(join(agentRoot, "node_modules", "react"));
    expect(reactRoots[0]).not.toContain(hostRoot);
    expect(reactDomRoots[0]).toContain(join(agentRoot, "node_modules", "react-dom"));
  });

  it("agent source 无法解析到请求的运行时库路径时,构建以插件产出的明确错误终止", async () => {
    // ★ 不能靠「祖先链上不含任何 node_modules」制造缺失场景:本仓由 pnpm 管理,
    // vitest/pnpm 会向进程注入 NODE_PATH,Node 的 `Module.globalPaths` 全局兜底
    // 会经由 `node_modules/.pnpm/node_modules` 这层 hoist 目录意外解析到宿主自己的
    // react 副本,使「全新孤立目录」这个前提在本测试环境下不成立(已实测复现)。
    // 改用确定性手段:agent 的假 react 包里真实不存在的子路径——不论全局兜底是否
    // 生效,`react` 包本身在 agentRoot/node_modules 下先一步命中,子路径解析必定失败。
    writeFileSync(
      join(agentRoot, "entry-missing-subpath.js"),
      `import x from "react/__definitely_missing_subpath__.js"; export default x;`,
    );
    const plugin = createReactSingletonPlugin(agentRoot);
    await expect(
      build({
        entryPoints: [join(agentRoot, "entry-missing-subpath.js")],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        plugins: [plugin],
        logLevel: "silent",
      }),
    ).rejects.toThrow(/无法从 agent source 根解析/);
  });
});

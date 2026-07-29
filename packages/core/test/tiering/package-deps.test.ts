import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  FORBIDDEN_PACKAGE_DEPS,
  PEER_ONLY_DEPS,
  auditPackageDeps,
  type PackageManifest,
} from "./package-deps.js";
import { PACKAGE_ROOTS } from "./package-roots.js";

/**
 * 包依赖守卫(spec: core-package-extraction,R1.2 / R1.3 / R1.4)。
 *
 * 断言内核包的**声明层**不含云沙箱 SDK / 数据库驱动 / MCP SDK / HTTP 框架 / 包注册表客户端,
 * 且 agent 运行时 SDK 只以 peer 出现。这条判据是本 spec 唯一**机械可校验**的价值证明:
 * 「它没有偷偷拖进云厂商 SDK」是可验证的事实,而不是一句承诺。
 */

const coreRoot = PACKAGE_ROOTS.find((r) => r.name === "core");

function manifestOf(dir: string): PackageManifest {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as PackageManifest;
}

describe("包依赖守卫 —— 内核包的声明层必须干净", () => {
  it("内核包根存在(空扫即失败,不得静默通过)", () => {
    // ★ 找不到包根时,下面每条断言都会因为"无物可查"而通过 —— 那是最像绿的一种失效。
    expect(coreRoot, "PACKAGE_ROOTS 里没有名为 core 的包根").toBeDefined();
    expect(fs.existsSync(path.join(coreRoot!.dir, "package.json"))).toBe(true);
  });

  it("dependencies / devDependencies 均不含被禁依赖", () => {
    const violations = auditPackageDeps(manifestOf(coreRoot!.dir));
    expect(
      violations.map((v) => `${v.name} @ ${v.field}(${v.why})`),
      `内核包的依赖声明出现了被禁项。源码干净但 package.json 里挂着它们,` +
        `消费方照样得装下来 —— 而本次拆包的全部价值就在那棵依赖树上。\n` +
        `修法:把用到它的实现摘去兼容层包(参考 sandbox-transport / session-store-postgres),` +
        `而不是放宽本名单。`,
    ).toEqual([]);
  });

  it("agent 运行时 SDK 以 peer 形式声明,而非硬依赖(R1.3)", () => {
    const pkg = manifestOf(coreRoot!.dir);
    for (const name of PEER_ONLY_DEPS) {
      expect(pkg.peerDependencies?.[name], `${name} 应出现在 peerDependencies`).toBeDefined();
      expect(pkg.dependencies?.[name], `${name} 不得出现在 dependencies`).toBeUndefined();
      expect(pkg.devDependencies?.[name], `${name} 不得出现在 devDependencies`).toBeUndefined();
    }
  });

  it("判别力自证:人为加入被禁依赖时报红并指出依赖名与所在字段", () => {
    // ★ 不能只验"真实声明是绿的"——那与"审计函数恒返回空数组"无法区分。
    for (const forbidden of FORBIDDEN_PACKAGE_DEPS) {
      const injected = auditPackageDeps({ devDependencies: { [forbidden.name]: "^1.0.0" } });
      expect(injected.map((v) => `${v.name}@${v.field}`)).toEqual([
        `${forbidden.name}@devDependencies`,
      ]);
    }
    // 子路径形态也要命中(如 `@modelcontextprotocol/sdk/client`)。
    expect(auditPackageDeps({ dependencies: { "e2b/code-interpreter": "1" } })).toHaveLength(1);
  });

  it("源码里对 agent SDK **只有类型引用**,没有值导入(R1.3 的源码侧判据)", () => {
    // ★ 声明层查干净了还不够。R1.3 有两半:声明列 peer + 源码仅类型引用。
    //   少了这一半,一个 `import { AuthStorage } from "…"` 就能让 optional peer 形同虚设 ——
    //   内核走**源码直连**分发,消费方 `tsc` 会编译到那个文件,SDK 没装就直接编译失败。
    //   (`config/model-options.ts` 与 `vision-settings/vision-model-options.ts` 正是因此
    //    被摘去兼容层包的 `model-sources` 模块。)
    const srcDir = path.join(coreRoot!.dir, "src");
    const walk = (d: string, out: string[] = []): string[] => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f, out);
        else if (e.name.endsWith(".ts")) out.push(f);
      }
      return out;
    };
    const files = walk(srcDir);
    expect(files.length, "core/src 扫到 0 个文件 —— 空扫的绿与真正的绿无法区分").toBeGreaterThan(0);

    // 跨行匹配:本仓大量 import 写成多行,逐行扫会整条漏掉(依赖方向守卫踩过同一个坑)。
    const VALUE_IMPORT =
      /(?:^|\n)[ \t]*import[ \t]+(?!type[ \t])[^;]*?from[ \t]*["']@earendil-works\/[^"']*["']/g;
    const offenders = files
      .map((f) => ({ f, hits: [...fs.readFileSync(f, "utf8").matchAll(VALUE_IMPORT)] }))
      .filter((x) => x.hits.length > 0)
      .map((x) => path.relative(coreRoot!.dir, x.f));

    expect(
      offenders,
      `以下内核文件**值**导入了 agent 运行时 SDK,与 R1.3 冲突:\n` +
        offenders.map((o) => `  ${o}\n`).join("") +
        `修法:把该文件摘去兼容层包(参考 src/model-sources/),或改为 \`import type\`。`,
    ).toEqual([]);
  });

  it("判别力自证:agent SDK 被误列为普通依赖时报红", () => {
    const injected = auditPackageDeps({ dependencies: { "@earendil-works/pi-coding-agent": "*" } });
    expect(injected.map((v) => v.field)).toEqual(["dependencies"]);
  });
});

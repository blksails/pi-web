import { describe, expect, it } from "vitest";
import {
  classifyTestSource,
  isDeclarationAcceptable,
  tierFromFilename,
  FORBIDDEN_DIRECT_IMPORTS,
} from "./tier-rules.js";

/**
 * 单元:分档判据(spec: test-tiering-fast-lane,任务 2.1)。
 *
 * ★ 本文件的样本源文本一律用**插值拆开**关键 token(`${FROM}`、`vi.${MOCK}`、`mkdtemp${""}`)。
 *   原因:守卫会扫描本文件自身的源文本;若样本里写出字面的 `from "node:child_process"` 或
 *   `vi.mock(`,守卫会把**这个测试文件**判成 it/fastMock 档,逼它改名 —— 一个判据的自测
 *   反被自己的判据打中。拆开 token 使样本在运行期仍是完整字符串,但在源文本层不构成命中。
 *   这不是取巧,是任何「扫描源码的规则」写自测时都要面对的自指问题。
 */

const FROM = "from";
const MOCK = "mock";

describe("classifyTestSource —— 由源文本判定档位", () => {
  it("直接导入子进程能力 → it 档,证据含 specifier 与行号", () => {
    const source = ["import { describe } " + FROM + ' "vitest";', "", "import cp " + FROM + ' "node:child_process";'].join("\n");

    const result = classifyTestSource(source);

    expect(result.tier).toBe("it");
    expect(result.evidence).toContainEqual({
      kind: "direct-import",
      detail: "node:child_process",
      line: 3,
    });
  });

  it("工厂式 vi.mock 的 e2b 不计入禁用依赖(真实 SDK 从不加载)→ 仅 fastMock,不降到 it", () => {
    const source = [
      `vi.${MOCK}("e2b", () => ({ Sandbox: { create: () => ({}) } }));`,
      "import { createE2bTransport } " + FROM + ' "../../src/rpc-channel/e2b-transport.js";',
    ].join("\n");

    const result = classifyTestSource(source);

    expect(result.tier).toBe("fastMock");
    expect(result.evidence.filter((e) => e.kind === "direct-import")).toEqual([]);
  });

  it("带 importOriginal 的 vi.mock → fastMock(需保留模块隔离)", () => {
    const source = [
      `vi.${MOCK}("../../src/workspace/key.js", async (importOriginal) => ({`,
      "  ...(await importOriginal()),",
      "  validateWorkspaceKey,",
      "}));",
    ].join("\n");

    const result = classifyTestSource(source);

    expect(result.tier).toBe("fastMock");
    expect(result.evidence).toContainEqual({ kind: "module-mock", detail: "vi.mock", line: 1 });
  });

  it("即便被工厂式 mock 遮蔽,真实临时目录仍使其降到 it 档", () => {
    const source = [
      `vi.${MOCK}("e2b", () => ({}));`,
      `const dir = await fs.mkdtemp${""}(join(tmpdir(), "x-"));`,
    ].join("\n");

    const result = classifyTestSource(source);

    expect(result.tier).toBe("it");
    expect(result.evidence).toContainEqual({ kind: "temp-dir", detail: "mkdtemp", line: 2 });
  });

  it("纯逻辑源文本 → fast 档,且证据为空(设计不变式)", () => {
    const source = [
      "import { describe, expect, it } " + FROM + ' "vitest";',
      "import { translate } " + FROM + ' "../../src/session/translate/index.js";',
      'it("works", () => expect(translate({})).toBeDefined());',
    ].join("\n");

    const result = classifyTestSource(source);

    expect(result.tier).toBe("fast");
    expect(result.evidence).toEqual([]);
  });

  it("注释里提到禁用依赖不算命中(行注释与块注释都剥)", () => {
    const source = [
      "// import cp " + FROM + ' "node:child_process";',
      "/**",
      " * 说明:早期实现会 " + FROM + ' "e2b" 直连,现已改注入。',
      " */",
      "import { translate } " + FROM + ' "../../src/session/translate/index.js";',
    ].join("\n");

    const result = classifyTestSource(source);

    expect(result.tier).toBe("fast");
    expect(result.evidence).toEqual([]);
  });

  it("剥注释后行号不变 —— 证据仍指向真实代码行", () => {
    const source = [
      "/* 一段",
      "   多行注释 */",
      "import cp " + FROM + ' "child_process";',
    ].join("\n");

    expect(classifyTestSource(source).evidence).toContainEqual({
      kind: "direct-import",
      detail: "child_process",
      line: 3,
    });
  });

  it("字符串字面量不剥 —— 否则 import specifier 本身就识别不出", () => {
    const source = "import x " + FROM + ' "@modelcontextprotocol/sdk/client/index.js";';

    expect(classifyTestSource(source).tier).toBe("it");
  });

  it("同一输入恒得同一结果(纯函数)", () => {
    const source = "import x " + FROM + ' "pg";';

    expect(classifyTestSource(source)).toEqual(classifyTestSource(source));
  });

  it("禁用名册覆盖六类重依赖,且按前缀匹配子路径", () => {
    for (const spec of FORBIDDEN_DIRECT_IMPORTS) {
      const result = classifyTestSource("import x " + FROM + ` "${spec}/sub";`);
      expect(result.tier, `${spec}/sub 应判 it`).toBe("it");
    }
  });
});

describe("tierFromFilename —— 由文件名反推声明档位", () => {
  it.each([
    ["session/pi-session.it.test.ts", "it"],
    ["rpc-channel/e2b-transport.mock.test.ts", "fastMock"],
    ["rpc-channel/sandbox-ws.e2e.test.ts", "e2e"],
    ["http/version.test.ts", "fast"],
  ] as const)("%s → %s", (filename, tier) => {
    expect(tierFromFilename(filename)).toBe(tier);
  });

  it("未知后缀按 fast 处理 —— 最宽松,故真违规者必被守卫拦住而非静默放行", () => {
    expect(tierFromFilename("weird.spec.test.ts")).toBe("fast");
  });

  it("只看基名,不受目录名干扰", () => {
    expect(tierFromFilename("test/integration/foo.test.ts")).toBe("fast");
  });
});

describe("isDeclarationAcceptable —— 允许过度声明,不允许过宽声明", () => {
  it("声明得比判定更严 → 接受", () => {
    expect(isDeclarationAcceptable("it", "fast")).toBe(true);
    expect(isDeclarationAcceptable("e2e", "it")).toBe(true);
  });

  it("声明得比判定更宽 → 拒绝", () => {
    expect(isDeclarationAcceptable("fast", "it")).toBe(false);
    expect(isDeclarationAcceptable("fastMock", "it")).toBe(false);
  });

  it("相等 → 接受", () => {
    expect(isDeclarationAcceptable("fastMock", "fastMock")).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  assertNoBundledSingletons,
  assertSingletonOccursOnce,
  findBundledSingletons,
  findSingletonOccurrences,
  ExternalsGuardError,
} from "../build/externals-guard.js";

describe("externals-guard", () => {
  it("clean bundle 通过", () => {
    const code = `import {jsx} from "react/jsx-runtime"; export default {manifestId:"x"};`;
    expect(() => assertNoBundledSingletons(code)).not.toThrow();
    expect(findBundledSingletons(code)).toHaveLength(0);
  });

  it("内联 React 被拒绝", () => {
    const code = `function x(){throw Error("Invalid hook call. Hooks can only be called inside ...")}`;
    expect(() => assertNoBundledSingletons(code)).toThrow(ExternalsGuardError);
  });

  it("内联 react-dom.development 被拒绝", () => {
    const code = `/* react-dom.development.js */ var ReactDOM = {};`;
    expect(findBundledSingletons(code).length).toBeGreaterThan(0);
  });
});

describe("assertSingletonOccursOnce", () => {
  const singletonMarker = (relPath: string) =>
    `var require_x = __commonJS({\n  "${relPath}"(exports, module) {}\n});`;

  it("0 次(未内联)被拒绝,且与多次的报错可区分", () => {
    const code = `export default {manifestId:"x"};`;
    expect(findSingletonOccurrences(code, "react")).toHaveLength(0);
    expect(() => assertSingletonOccursOnce(code, "react")).toThrow(ExternalsGuardError);
    try {
      assertSingletonOccursOnce(code, "react");
      throw new Error("expected assertSingletonOccursOnce to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalsGuardError);
      expect((err as ExternalsGuardError).message).toMatch(/0 份/);
    }
  });

  it("恰好 1 份通过(单个包安装的多个内部文件不应被重复计数)", () => {
    // esbuild 打包一份 react 时,`index.js` 与 `cjs/react.development.js` 各自
    // 都会生成一条 __commonJS 标记,但二者共享同一安装目录前缀 —— 应被判定为同一份副本。
    const code = [
      singletonMarker("node_modules/.pnpm/react@19.2.7/node_modules/react/index.js"),
      singletonMarker(
        "node_modules/.pnpm/react@19.2.7/node_modules/react/cjs/react.development.js",
      ),
    ].join("\n");
    expect(findSingletonOccurrences(code, "react")).toHaveLength(1);
    expect(() => assertSingletonOccursOnce(code, "react")).not.toThrow();
  });

  it("多份(重复副本)被拒绝,且与 0 份的报错可区分", () => {
    const code = [
      singletonMarker(
        "node_modules/.pnpm/react@19.2.7/node_modules/react/cjs/react.development.js",
      ),
      singletonMarker(
        "agent/node_modules/.pnpm/react@18.3.1/node_modules/react/cjs/react.development.js",
      ),
    ].join("\n");
    expect(findSingletonOccurrences(code, "react")).toHaveLength(2);
    try {
      assertSingletonOccursOnce(code, "react");
      throw new Error("expected assertSingletonOccursOnce to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ExternalsGuardError);
      expect((err as ExternalsGuardError).message).toMatch(/2 份/);
      expect((err as ExternalsGuardError).message).not.toMatch(/0 份/);
    }
  });

  it("不同库名互不干扰(前缀边界:react 不会误命中 react-dom)", () => {
    const code = singletonMarker("node_modules/react-dom/cjs/react-dom.development.js");
    expect(findSingletonOccurrences(code, "react")).toHaveLength(0);
    expect(findSingletonOccurrences(code, "react-dom")).toHaveLength(1);
  });
});

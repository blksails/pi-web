import { describe, expect, it } from "vitest";
import {
  assertNoBundledSingletons,
  findBundledSingletons,
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

import { describe, expect, it } from "vitest";
import { scopeCss } from "../build/css-scope-plugin.js";

describe("scopeCss", () => {
  it("前缀注入:class 选择器加 pw-<extId>-", () => {
    const r = scopeCss(".card { color: red }", "acme");
    expect(r.errors).toHaveLength(0);
    expect(r.css).toContain(".pw-acme-card");
  });

  it("全局选择器被拒绝:* / html / body / :root", () => {
    for (const sel of ["*", "html", "body", ":root"]) {
      const r = scopeCss(`${sel} { margin: 0 }`, "acme");
      expect(r.errors.length).toBeGreaterThan(0);
    }
  });

  it("顶层标签选择器被拒绝", () => {
    const r = scopeCss("div { display: flex }", "acme");
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it("@keyframes 命名空间化", () => {
    const r = scopeCss("@keyframes spin { from { opacity: 0 } to { opacity: 1 } }", "acme");
    expect(r.css).toContain("@keyframes pw-acme-spin");
  });

  it("animation 引用同步改写到命名空间化的 keyframe 名", () => {
    const r = scopeCss(
      "@keyframes spin { to { transform: rotate(360deg) } } .box { animation: spin 2s linear infinite }",
      "acme",
    );
    expect(r.errors).toHaveLength(0);
    expect(r.css).toContain("@keyframes pw-acme-spin");
    // .box → .pw-acme-box;animation: spin → pw-acme-spin
    expect(r.css).toMatch(/animation:\s*pw-acme-spin/);
    expect(r.css).not.toMatch(/animation:\s*spin\b/);
  });

  it("拒绝 Tailwind preflight / universal reset", () => {
    const r = scopeCss("*,::before,::after{box-sizing:border-box}", "acme");
    expect(r.errors.some((e) => /preflight|reset/i.test(e))).toBe(true);
  });

  it("自定义变量须 --pw-<extId>- 前缀", () => {
    const bad = scopeCss(".x { --accent: #09f }", "acme");
    expect(bad.errors.length).toBeGreaterThan(0);
    const ok = scopeCss(".x { --pw-acme-accent: #09f }", "acme");
    expect(ok.errors).toHaveLength(0);
  });

  it("@layer base 被拒绝", () => {
    const r = scopeCss("@layer base { .x { color: red } }", "acme");
    expect(r.errors.some((e) => /layer base/i.test(e))).toBe(true);
  });

  it("@media 内层递归 scope", () => {
    const r = scopeCss("@media (min-width: 600px) { .card { color: red } }", "acme");
    expect(r.errors).toHaveLength(0);
    expect(r.css).toContain(".pw-acme-card");
    expect(r.css).toContain("@media");
  });
});

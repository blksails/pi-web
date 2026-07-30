/**
 * template-name 单元测试(spec sandbox-baked-agent-image,任务 1.1;Req 2.6/3.2)。
 *
 * 纯函数派生:source 稳定标识(policySource)→ slug / 镜像名 / 模板名。
 * 覆盖:dir/git/builtin 三型标识、同输入恒同输出、slug 字符集安全(命名安全 + 不含 `.`)、
 * 模板名与 agent-sandbox dynamic 规则(`^piweb-agent-(.+)\.(.+)$`)互逆、tag 含 `.` 的归一。
 */
import { describe, it, expect } from "vitest";
import {
  deriveSlug,
  deriveImageName,
  deriveTemplateName,
  type SourceIdentityInput,
} from "../../src/sandbox-image/index.js";

const DIR: SourceIdentityInput = { policySource: "/Users/x/agents/my-agent" };
const GIT: SourceIdentityInput = {
  policySource: "https://github.com/user/repo.git",
};
const BUILTIN: SourceIdentityInput = { policySource: "builtin:default-agent" };

/** agent-sandbox dynamic 规则 `piweb-agent-(?P<name>.+)\.(?P<version>.+)$` 的 JS 等价式。 */
const DYNAMIC_RULE = /^piweb-agent-(.+)\.(.+)$/;

/** slug 命名安全字符集:小写字母数字与连字符,首尾不为连字符,且不含 `.`。 */
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

describe("deriveSlug — 三型标识产出合理 slug (Req 3.2)", () => {
  it("dir 型:basename 为前缀 + 8 位哈希后缀", () => {
    const slug = deriveSlug(DIR);
    expect(slug).toMatch(/^my-agent-[0-9a-f]{8}$/);
  });

  it("git 型:剥 .git 后取仓名为前缀", () => {
    const slug = deriveSlug(GIT);
    expect(slug).toMatch(/^repo-[0-9a-f]{8}$/);
  });

  it("builtin 型:剥 builtin: 前缀取名", () => {
    const slug = deriveSlug(BUILTIN);
    expect(slug).toMatch(/^default-agent-[0-9a-f]{8}$/);
  });

  it("scp 式 git 标识(git@host:user/repo.git)同样取仓名", () => {
    const slug = deriveSlug({ policySource: "git@github.com:user/repo.git" });
    expect(slug).toMatch(/^repo-[0-9a-f]{8}$/);
  });

  it("dir 型带尾斜杠不影响 basename 提取", () => {
    const slug = deriveSlug({ policySource: "/Users/x/agents/my-agent/" });
    expect(slug).toMatch(/^my-agent-[0-9a-f]{8}$/);
  });
});

describe("deriveSlug — 同输入恒同输出 (Req 2.6/3.2)", () => {
  it("对同一标识多次派生结果一致", () => {
    for (const input of [DIR, GIT, BUILTIN]) {
      expect(deriveSlug(input)).toBe(deriveSlug(input));
      expect(deriveImageName(input, "v1")).toBe(deriveImageName(input, "v1"));
      expect(deriveTemplateName(input, "v1")).toBe(
        deriveTemplateName(input, "v1"),
      );
    }
  });

  it("同 basename 不同标识 → 哈希后缀区分,slug 不冲突", () => {
    const a = deriveSlug({ policySource: "/Users/a/agents/my-agent" });
    const b = deriveSlug({ policySource: "/Users/b/agents/my-agent" });
    expect(a).not.toBe(b);
    expect(a).toMatch(/^my-agent-/);
    expect(b).toMatch(/^my-agent-/);
  });
});

describe("deriveSlug — 字符集安全 (Req 2.6)", () => {
  it("basename 含点/大写/下划线时归一为命名安全 slug(不含 `.`)", () => {
    const slug = deriveSlug({ policySource: "/x/My.Agent_V2" });
    expect(slug).toMatch(SLUG_PATTERN);
    expect(slug).not.toContain(".");
    expect(slug).toMatch(/^my-agent-v2-[0-9a-f]{8}$/);
  });

  it("basename 含空格与连续非法字符时折叠为单个连字符", () => {
    const slug = deriveSlug({ policySource: "/x/my  agent!!name" });
    expect(slug).toMatch(SLUG_PATTERN);
    expect(slug).toMatch(/^my-agent-name-[0-9a-f]{8}$/);
  });

  it("basename 全为非法字符(如纯中文)时回退占位前缀,slug 仍合法", () => {
    const slug = deriveSlug({ policySource: "/x/代理" });
    expect(slug).toMatch(SLUG_PATTERN);
    expect(slug).toMatch(/^agent-[0-9a-f]{8}$/);
  });

  it("空 policySource 抛 TypeError(前置条件)", () => {
    expect(() => deriveSlug({ policySource: "" })).toThrow(TypeError);
    expect(() => deriveSlug({ policySource: "   " })).toThrow(TypeError);
  });
});

describe("deriveImageName / deriveTemplateName — 派生形态 (Req 2.6/3.2)", () => {
  it("镜像名 = piweb-agent/<slug>:<tag>", () => {
    const slug = deriveSlug(DIR);
    expect(deriveImageName(DIR, "abc123")).toBe(`piweb-agent/${slug}:abc123`);
  });

  it("模板名 = piweb-agent-<slug>.<tag>", () => {
    const slug = deriveSlug(DIR);
    expect(deriveTemplateName(DIR, "abc123")).toBe(
      `piweb-agent-${slug}.abc123`,
    );
  });

  it("空 tag 抛 TypeError(前置条件)", () => {
    expect(() => deriveImageName(DIR, "")).toThrow(TypeError);
    expect(() => deriveTemplateName(DIR, " ")).toThrow(TypeError);
  });

  it("tag 含 `.` 时归一为 `-`(镜像名与模板名一致归一)", () => {
    const slug = deriveSlug(DIR);
    expect(deriveImageName(DIR, "1.2.3")).toBe(`piweb-agent/${slug}:1-2-3`);
    expect(deriveTemplateName(DIR, "1.2.3")).toBe(
      `piweb-agent-${slug}.1-2-3`,
    );
  });
});

describe("模板名 ↔ dynamic 规则互逆 (Req 3.2)", () => {
  it.each([
    ["dir", DIR],
    ["git", GIT],
    ["builtin", BUILTIN],
  ] as const)("%s 型:dynamic 规则提取的 name/version 与 slug/tag 互逆", (_kind, input) => {
    const tag = "deadbeef1234";
    const template = deriveTemplateName(input, tag);
    const m = DYNAMIC_RULE.exec(template);
    expect(m).not.toBeNull();
    const [, name, version] = m!;
    expect(name).toBe(deriveSlug(input));
    expect(version).toBe(tag);
    // dynamic 规则右边:piweb-agent/<name>:<version> 应还原出镜像名
    expect(`piweb-agent/${name}:${version}`).toBe(deriveImageName(input, tag));
  });

  it("tag 归一后模板名中仍只有一个 `.`(分隔符),互逆无歧义", () => {
    const template = deriveTemplateName(DIR, "1.2.3");
    expect(template.split(".").length).toBe(2);
    const m = DYNAMIC_RULE.exec(template);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(deriveSlug(DIR));
    expect(m![2]).toBe("1-2-3");
  });
});

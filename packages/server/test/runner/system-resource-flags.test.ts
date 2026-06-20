/**
 * system-resource-flags — custom 模式系统资源开关(--no-skills / --no-extensions)
 * 从 runner argv 解析到 resourceLoaderOptions 映射的端到端单元覆盖。
 * spec: system-resource-toggle-fix(Req 1.x / 2.x / 3.x / 5.1)。
 */
import { describe, expect, it } from "vitest";
import type { SkillsOverride } from "../../src/runner/agent-definition.js";
import { mapResourceLoaderOptions } from "../../src/runner/option-mapper.js";
import { parseRunnerArgs } from "../../src/runner/runner.js";

/** 以最小合法 argv(含必需 --agent)包裹被测 flag。 */
function parse(extra: readonly string[]) {
  return parseRunnerArgs(["--agent", "/x/index.ts", ...extra]);
}

/** 调用 skillsOverride 并取回其产出的 skills 集合。 */
function callSkills(override: SkillsOverride): unknown {
  // SkillsOverride 入参携带已发现的 base(skills + diagnostics);此处给出非空 base,
  // 断言覆盖后结果为空,证明「清空」语义且优先于 def.skills。
  const base = { skills: [{ name: "discovered-skill" }], diagnostics: [] } as never;
  return (override(base) as { skills: unknown[] }).skills;
}

describe("parseRunnerArgs — 系统资源开关识别(Req 1.1 / 3.1-3.4)", () => {
  it("裸 --no-skills 视为关闭(noSkills=true),extensions 不受影响", () => {
    const args = parse(["--no-skills"]);
    expect(args.noSkills).toBe(true);
    expect(args.noExtensions).toBeUndefined();
  });

  it("裸 --no-extensions 视为关闭(noExtensions=true),skills 不受影响", () => {
    const args = parse(["--no-extensions"]);
    expect(args.noExtensions).toBe(true);
    expect(args.noSkills).toBeUndefined();
  });

  it("两开关可同时出现且相互独立(Req 3.3)", () => {
    const args = parse(["--no-skills", "--no-extensions"]);
    expect(args.noSkills).toBe(true);
    expect(args.noExtensions).toBe(true);
  });

  it("均不出现时两意图皆未设(默认载入,Req 3.4)", () => {
    const args = parse([]);
    expect(args.noSkills).toBeUndefined();
    expect(args.noExtensions).toBeUndefined();
  });

  it("--no-skills=false 显式开启(noSkills=false)", () => {
    const args = parse(["--no-skills=false"]);
    expect(args.noSkills).toBe(false);
  });
});

describe("mapResourceLoaderOptions — 开关映射为资源载入覆盖(Req 1.x / 2.x)", () => {
  it("noSkills 时产出空 skills 覆盖,且优先于 def.skills(Req 1.1 / 1.4)", () => {
    const defOwnSkills: SkillsOverride = (base) => base; // agent 自声明:原样保留
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      { skills: defOwnSkills },
      { noSkills: true },
    );
    expect(typeof resourceLoaderOptions.skillsOverride).toBe("function");
    // 覆盖应清空,而非沿用 agent 自声明的「原样保留」。
    expect(callSkills(resourceLoaderOptions.skillsOverride!)).toEqual([]);
  });

  it("noExtensions 时设 noExtensions=true,且强制注入路径仍保留(Req 2.1 / 2.3)", () => {
    const forced = "/abs/pi-sandbox/index.ts";
    const { resourceLoaderOptions } = mapResourceLoaderOptions(
      {},
      { forcedExtensionPaths: [forced], noExtensions: true },
    );
    expect(resourceLoaderOptions.noExtensions).toBe(true);
    expect(resourceLoaderOptions.additionalExtensionPaths).toContain(forced);
  });

  it("仅 noSkills 不触碰 extensions 载入(Req 3.1)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({}, { noSkills: true });
    expect(typeof resourceLoaderOptions.skillsOverride).toBe("function");
    expect("noExtensions" in resourceLoaderOptions).toBe(false);
  });

  it("仅 noExtensions 不触碰 skills 载入(Req 3.2)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({}, { noExtensions: true });
    expect(resourceLoaderOptions.noExtensions).toBe(true);
    expect("skillsOverride" in resourceLoaderOptions).toBe(false);
  });

  it("两开关缺省时不注入任何资源覆盖(Req 1.3 / 2.2 / 3.4)", () => {
    const { resourceLoaderOptions } = mapResourceLoaderOptions({});
    expect("skillsOverride" in resourceLoaderOptions).toBe(false);
    expect("noExtensions" in resourceLoaderOptions).toBe(false);
  });
});

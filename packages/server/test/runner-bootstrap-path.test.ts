/**
 * 引导路径三级解析（spec: runner-package-extraction 任务 4.1；design C3；Req 3.1/3.2/3.3/2.5）。
 *
 * ★ 这些用例**不构成**引导路径正确性的部署态证据（Req 3.5 明确排除单测与开发态的绿）。
 *   它们覆盖的是**分支逻辑**：哪一级命中、失败时是否抛错、错误里有没有列出所查位置。
 *   部署态证据由任务 6.2（换机复现 + 产物树包解析实测）交付。
 */
import { describe, expect, it } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";
import {
  defaultResolutionDeps,
  resolveRunnerBootstrapPath,
  runnerBootstrapPath,
  type RunnerBootstrapResolutionDeps,
} from "../src/runner-bootstrap-path.js";

const CWD_RELATIVE = path.join("packages", "runner", "runner-bootstrap.mjs");

/** 除显式覆盖外一律「解析不到 / 文件不存在」的桩，保证每条分支被单独驱动。 */
function deps(over: Partial<RunnerBootstrapResolutionDeps>): RunnerBootstrapResolutionDeps {
  return {
    resolvePackageSubpath: () => {
      throw new Error("Cannot find module '@blksails/pi-web-runner/runner-bootstrap.mjs'");
    },
    exists: () => false,
    cwd: () => path.join(path.sep, "fake", "cwd"),
    ...over,
  };
}

describe("runnerBootstrapPath 三级解析", () => {
  describe("① 包解析", () => {
    it("命中时返回包解析结果，且不看 process.cwd()", () => {
      const resolved = path.join(path.sep, "pkg", "runner", "runner-bootstrap.mjs");
      const seenCwd: string[] = [];
      const got = resolveRunnerBootstrapPath(
        deps({
          resolvePackageSubpath: (specifier) => {
            expect(specifier).toBe("@blksails/pi-web-runner/runner-bootstrap.mjs");
            return resolved;
          },
          exists: (p) => p === resolved,
          cwd: () => {
            seenCwd.push("called");
            return path.join(path.sep, "irrelevant");
          },
        }),
      );

      expect(got).toBe(resolved);
      // 与工作目录无关：命中第一级时压根没去问 cwd（design C3 的 Invariant）。
      expect(seenCwd).toEqual([]);
    });

    it("解析成功但文件不存在时不采信，降到第二级", () => {
      const ghost = path.join(path.sep, "pkg", "runner", "runner-bootstrap.mjs");
      const cwd = path.join(path.sep, "real", "root");
      const fromCwd = path.join(cwd, CWD_RELATIVE);

      const got = resolveRunnerBootstrapPath(
        deps({
          resolvePackageSubpath: () => ghost,
          exists: (p) => p === fromCwd,
          cwd: () => cwd,
        }),
      );

      expect(got).toBe(fromCwd);
    });
  });

  describe("② 工作目录兜底", () => {
    it("包解析失败但 cwd 下脚本存在时返回它", () => {
      const cwd = path.join(path.sep, "dist", "root");
      const fromCwd = path.join(cwd, CWD_RELATIVE);

      const got = resolveRunnerBootstrapPath(
        deps({ exists: (p) => p === fromCwd, cwd: () => cwd }),
      );

      expect(got).toBe(fromCwd);
    });

    it("★ 兜底路径不存在时不再无条件返回它（旧实现的病）", () => {
      const cwd = path.join(path.sep, "dist", "root");
      // exists 恒 false —— 旧实现会把这个不存在的串直接返回，失败延后到 spawn。
      expect(() => resolveRunnerBootstrapPath(deps({ cwd: () => cwd }))).toThrow();
    });
  });

  describe("③ 两级皆不成立则抛错", () => {
    const cwd = path.join(path.sep, "nowhere");

    it("抛出的错误消息包含所查过的两个位置", () => {
      let caught: unknown;
      try {
        resolveRunnerBootstrapPath(deps({ cwd: () => cwd }));
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeInstanceOf(Error);
      const message = (caught as Error).message;

      // 位置一：包解析的 specifier（第一级查过的地方）
      expect(message).toContain("@blksails/pi-web-runner/runner-bootstrap.mjs");
      // 位置二：工作目录兜底的绝对路径（第二级查过的地方）
      expect(message).toContain(path.join(cwd, CWD_RELATIVE));
      // 失败原因也带上，便于区分「包没装」与「文件被删」
      expect(message).toContain("Cannot find module");
    });

    it("第一级解析成功但文件不存在时，错误里给出的是解析到的绝对路径", () => {
      const ghost = path.join(path.sep, "pkg", "runner", "runner-bootstrap.mjs");
      let message = "";
      try {
        resolveRunnerBootstrapPath(
          deps({ resolvePackageSubpath: () => ghost, cwd: () => cwd }),
        );
      } catch (err) {
        message = (err as Error).message;
      }

      expect(message).toContain(ghost);
      expect(message).toContain(path.join(cwd, CWD_RELATIVE));
    });
  });

  describe("默认装配", () => {
    it("签名不变，且在本仓真实解析到存在的引导脚本", () => {
      const got = runnerBootstrapPath();

      expect(typeof got).toBe("string");
      expect(path.isAbsolute(got)).toBe(true);
      expect(path.basename(got)).toBe("runner-bootstrap.mjs");
      // Req 3.1/3.2：返回值指向**真实存在**的文件，而不只是「没抛错」。
      expect(existsSync(got)).toBe(true);
    });

    it("默认 deps 的包解析走的是 runner 包的子路径导出", () => {
      const resolved = defaultResolutionDeps.resolvePackageSubpath(
        "@blksails/pi-web-runner/runner-bootstrap.mjs",
      );

      expect(existsSync(resolved)).toBe(true);
      expect(resolved).toContain(path.join("packages", "runner"));
    });
  });
});

/**
 * `.env` / `.env.local` 加载(spec vite-spa-migration 后续修复)。
 *
 * 旧宿主由 Next **内置**加载这两个文件。脱离 Next 后该能力随之消失,用户的 provider 密钥与
 * 门控会在 `pnpm dev` / `pi-web` 下**静默全部失效** —— 既有 e2e 抓不到,因为它们都显式传 env。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnvFiles } from "@/server/load-env";

const KEYS = ["T_FOO", "T_BAR", "T_ONLY_ENV"] as const;
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "pi-env-"));
  for (const k of KEYS) delete process.env[k];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  for (const k of KEYS) delete process.env[k];
});

describe("loadEnvFiles", () => {
  it(".env.local 覆盖 .env(文件之间后者优先)", () => {
    writeFileSync(join(dir, ".env"), "T_FOO=from_env\n");
    writeFileSync(join(dir, ".env.local"), "T_FOO=from_local\n");
    loadEnvFiles(dir);
    expect(process.env.T_FOO).toBe("from_local");
  });

  it("真实进程 env 优先,不被文件覆盖(CLI 的 -p / CI 注入不被顶掉)", () => {
    process.env.T_BAR = "from_process";
    writeFileSync(join(dir, ".env"), "T_BAR=from_env\n");
    writeFileSync(join(dir, ".env.local"), "T_BAR=from_local\n");
    loadEnvFiles(dir);
    expect(process.env.T_BAR).toBe("from_process");
  });

  it("仅 .env 提供的键也会被填充", () => {
    writeFileSync(join(dir, ".env"), "T_ONLY_ENV=yes\n");
    loadEnvFiles(dir);
    expect(process.env.T_ONLY_ENV).toBe("yes");
  });

  it("返回实际加载的文件名", () => {
    writeFileSync(join(dir, ".env"), "T_FOO=a\n");
    expect(loadEnvFiles(dir)).toEqual([".env"]);
    writeFileSync(join(dir, ".env.local"), "T_FOO=b\n");
    expect(loadEnvFiles(dir)).toEqual([".env", ".env.local"]);
  });

  it("文件缺失是正常情况:不抛,返回空", () => {
    expect(() => loadEnvFiles(join(dir, "nope"))).not.toThrow();
    expect(loadEnvFiles(join(dir, "nope"))).toEqual([]);
  });
});

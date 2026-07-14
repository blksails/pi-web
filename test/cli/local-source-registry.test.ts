// @vitest-environment node
/**
 * LocalSourceRegistry 单测(spec cli-package-commands,任务 4.1,Req 9.1–9.5)。
 *
 * 边界:本组件只拥有写入语义;读取语义归既有 `RegistrySourceProvider`,
 * 此处不 import 它 —— 直接读回写入的 JSON 文件断言其形态,验证与既有 provider
 * 共享的文件契约未被破坏。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerLocalSource,
  unregisterLocalSource,
} from "@/server/cli/install/local-source-registry";

let root: string;
let registryPath: string;
let targetDir: string;

/** 构造一个「有效包目录」:存在且带 index.ts 入口(与 scan-provider/probeEntry 判据一致)。 */
function seedValidPackageDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.ts"), "export default {};\n");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "local-source-registry-test-"));
  registryPath = join(root, "agent-dir", "sources.json");
  targetDir = join(root, "my-local-agent");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function readRegistryRaw(): unknown {
  return JSON.parse(readFileSync(registryPath, "utf8"));
}

describe("registerLocalSource: 成功登记(Req 9.2, 9.3)", () => {
  it("登记一个有效包目录后,文件中出现该条目", async () => {
    seedValidPackageDir(targetDir);

    const result = await registerLocalSource({ registryPath, target: targetDir });
    expect(result.ok).toBe(true);

    const raw = readRegistryRaw() as { sources: Array<{ source: string }> };
    expect(Array.isArray(raw.sources)).toBe(true);
    expect(raw.sources).toHaveLength(1);
    expect(raw.sources[0]?.source).toBe(realpathSync(targetDir));
  });

  it("登记表文件不存在时,首次登记创建之(含父目录)", async () => {
    seedValidPackageDir(targetDir);
    expect(existsSync(registryPath)).toBe(false);

    const result = await registerLocalSource({ registryPath, target: targetDir });
    expect(result.ok).toBe(true);
    expect(existsSync(registryPath)).toBe(true);
  });
});

describe("registerLocalSource: 有效性校验(Req 9.5)", () => {
  it("目标不存在时报错且非零判别码,不写文件", async () => {
    const missing = join(root, "does-not-exist");
    const result = await registerLocalSource({ registryPath, target: missing });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TARGET_NOT_FOUND");
    }
    expect(existsSync(registryPath)).toBe(false);
  });

  it("目标是普通文件(非目录)时报错,不写文件", async () => {
    const filePath = join(root, "just-a-file.txt");
    writeFileSync(filePath, "hello");

    const result = await registerLocalSource({ registryPath, target: filePath });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("TARGET_NOT_A_DIRECTORY");
    }
    expect(existsSync(registryPath)).toBe(false);
  });

  it("目标是无效包目录(pi-web.entry 覆盖指向不存在的文件)时报错,不写文件", async () => {
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(
      join(targetDir, "package.json"),
      JSON.stringify({ name: "broken", "pi-web": { entry: "./missing-entry.js" } }),
    );

    const result = await registerLocalSource({ registryPath, target: targetDir });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INVALID_PACKAGE_DIRECTORY");
    }
    expect(existsSync(registryPath)).toBe(false);
  });
});

describe("registerLocalSource: 未知字段保留(观察态,Req 9.4)", () => {
  it("登记新条目后,顶层未知键与既有条目内的未知键完好无损", async () => {
    seedValidPackageDir(targetDir);
    mkdirSync(join(root, "agent-dir"), { recursive: true });
    writeFileSync(
      registryPath,
      JSON.stringify(
        {
          sources: [{ source: "/some/other/dir", myExtra: 1 }],
          _customTool: { keep: "me" },
        },
        null,
        2,
      ),
    );

    const result = await registerLocalSource({ registryPath, target: targetDir });
    expect(result.ok).toBe(true);

    const raw = readRegistryRaw() as {
      sources: Array<{ source: string; myExtra?: number }>;
      _customTool?: { keep?: string };
    };
    expect(raw._customTool).toEqual({ keep: "me" });
    const preserved = raw.sources.find((s) => s.source === "/some/other/dir");
    expect(preserved?.myExtra).toBe(1);
    expect(raw.sources).toHaveLength(2);
    expect(raw.sources.some((s) => s.source === realpathSync(targetDir))).toBe(true);
  });
});

describe("registerLocalSource: 重复登记幂等(观察态,Req 9.3)", () => {
  it("连续登记同一来源两次,条目数不变", async () => {
    seedValidPackageDir(targetDir);

    const first = await registerLocalSource({ registryPath, target: targetDir });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.value.created).toBe(true);

    const second = await registerLocalSource({ registryPath, target: targetDir });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.created).toBe(false);

    const raw = readRegistryRaw() as { sources: unknown[] };
    expect(raw.sources).toHaveLength(1);
  });
});

describe("unregisterLocalSource: 除名(Req 9.4)", () => {
  it("除名后条目消失", async () => {
    seedValidPackageDir(targetDir);
    await registerLocalSource({ registryPath, target: targetDir });

    const result = await unregisterLocalSource({ registryPath, target: targetDir });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.removed).toBe(true);

    const raw = readRegistryRaw() as { sources: unknown[] };
    expect(raw.sources).toHaveLength(0);
  });

  it("除名不存在的条目为无操作(不报错,removed=false)", async () => {
    seedValidPackageDir(targetDir);
    const result = await unregisterLocalSource({ registryPath, target: targetDir });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.removed).toBe(false);
  });

  it("除名保留其余条目与未知字段", async () => {
    mkdirSync(join(root, "agent-dir"), { recursive: true });
    seedValidPackageDir(targetDir);
    await registerLocalSource({ registryPath, target: targetDir });

    const other = join(root, "other-agent");
    seedValidPackageDir(other);
    await registerLocalSource({ registryPath, target: other });

    // 手工注入一个未知顶层字段,验证除名路径也保留它。
    const before = readRegistryRaw() as Record<string, unknown>;
    writeFileSync(registryPath, JSON.stringify({ ...before, _keepMe: true }, null, 2));

    await unregisterLocalSource({ registryPath, target: targetDir });

    const raw = readRegistryRaw() as { sources: Array<{ source: string }>; _keepMe?: boolean };
    expect(raw._keepMe).toBe(true);
    expect(raw.sources).toHaveLength(1);
    expect(raw.sources[0]?.source).toBe(realpathSync(other));
  });
});

describe("坏 JSON 的登记表(裁决:报错而非静默覆盖)", () => {
  it("登记表文件是坏 JSON 时,register 报错且不覆盖原文件内容", async () => {
    seedValidPackageDir(targetDir);
    mkdirSync(join(root, "agent-dir"), { recursive: true });
    const brokenContent = "{ this is not valid json ";
    writeFileSync(registryPath, brokenContent);

    const result = await registerLocalSource({ registryPath, target: targetDir });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REGISTRY_FILE_CORRUPT");
    }
    // 原文件必须原样保留(未被静默覆盖/清空)。
    expect(readFileSync(registryPath, "utf8")).toBe(brokenContent);
  });

  it("登记表文件是坏 JSON 时,unregister 也报错而非静默通过", async () => {
    mkdirSync(join(root, "agent-dir"), { recursive: true });
    const brokenContent = "not json at all";
    writeFileSync(registryPath, brokenContent);

    const result = await unregisterLocalSource({ registryPath, target: targetDir });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("REGISTRY_FILE_CORRUPT");
    }
  });
});

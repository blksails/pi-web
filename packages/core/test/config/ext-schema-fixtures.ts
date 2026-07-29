/**
 * ext-schema-fixtures — 在临时 agentDir 里种入「已安装假扩展」,供 schema 解析器单测 /
 * 集成 / e2e 复用。布局与 `package-install-path` 解析保持一致(npm/git/local)。
 */
import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import {
  packageInstallDir,
  packageIdFromSpec,
} from "../../src/config/package-install-path.js";

export interface PiSettingsEntry {
  readonly file: string;
  readonly schema: string;
}

export interface SeedExtensionSpec {
  /** packages[] 条目,如 "npm:pi-mcp-adapter@1.0.0" / "git:github.com/o/r@ref" / "local:/abs"。 */
  readonly spec: string;
  /** 写入包 package.json 的 `pi.settings`(声明配置文件名 + 包内 schema 路径)。 */
  readonly piSettings?: PiSettingsEntry | ReadonlyArray<PiSettingsEntry>;
  /** 包内 schema 文件:包内相对路径 → JSON Schema 内容。 */
  readonly schemaFiles?: Record<string, unknown>;
  /** 是否计入 settings.json packages[](即「已安装」)。默认 true;false = 未安装(门控反例)。 */
  readonly installed?: boolean;
  /** 覆盖 package.json 的 name(默认取规范 id)。 */
  readonly pkgName?: string;
}

export interface SeedAgentDirOptions {
  readonly extensions?: ReadonlyArray<SeedExtensionSpec>;
  /** agentDir 根下已存在的独立配置文件:文件名 → 内容。 */
  readonly configFiles?: Record<string, unknown>;
  /** 合并进 settings.json 的额外键。 */
  readonly settingsExtra?: Record<string, unknown>;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, JSON.stringify(value, null, 2) + "\n", "utf8");
}

/**
 * 在 `agentDir` 写入 settings.json(packages[]) + 各扩展包(package.json + 包内 schema) +
 * 根下既有配置文件。返回写入的 packages[]。
 */
export async function seedAgentDir(
  agentDir: string,
  opts: SeedAgentDirOptions = {},
): Promise<{ packages: string[] }> {
  const exts = opts.extensions ?? [];
  const packages: string[] = [];

  for (const ext of exts) {
    if (ext.installed !== false) packages.push(ext.spec);

    const dir = packageInstallDir(ext.spec, agentDir);
    if (dir === undefined) continue;

    const pkgJson: Record<string, unknown> = {
      name: ext.pkgName ?? packageIdFromSpec(ext.spec),
      version: "1.0.0",
    };
    if (ext.piSettings !== undefined) pkgJson["pi"] = { settings: ext.piSettings };
    await writeJson(join(dir, "package.json"), pkgJson);

    for (const [rel, content] of Object.entries(ext.schemaFiles ?? {})) {
      await writeJson(join(dir, rel), content);
    }
  }

  await writeJson(join(agentDir, "settings.json"), {
    packages,
    ...(opts.settingsExtra ?? {}),
  });

  for (const [name, content] of Object.entries(opts.configFiles ?? {})) {
    await writeJson(join(agentDir, name), content);
  }

  return { packages };
}

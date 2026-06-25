#!/usr/bin/env node
/**
 * pi-web build — CLI(任务 2.4)。
 *
 * 用法:pi-web build --id <extId> --api <range> --dir <.pi/web> --out <dir> [--sign <ed25519PrivateKeyBase64Pkcs8>]
 *
 * 注:本仓库以原生 TS 运行(无包构建步骤),示例与脚本可经 TS 运行时
 * (如 `node --import tsx`)执行本 CLI,或直接调用程序化 API `buildWebExtension`。
 */
import { buildWebExtension, type BuildOptions } from "./build.js";

function parseArgs(argv: readonly string[]): Partial<BuildOptions> & { _cmd?: string } {
  const out: Record<string, string> = {};
  let cmd: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (!a.startsWith("--")) {
      if (cmd === undefined) cmd = a;
      continue;
    }
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val !== undefined && !val.startsWith("--")) {
      out[key] = val;
      i++;
    } else {
      out[key] = "true";
    }
  }
  return {
    _cmd: cmd,
    ...(out.id !== undefined ? { id: out.id } : {}),
    ...(out.api !== undefined ? { targetApiVersion: out.api } : {}),
    ...(out.dir !== undefined ? { entryDir: out.dir } : {}),
    ...(out.out !== undefined ? { outDir: out.out } : {}),
    ...(out.sign !== undefined ? { signKey: out.sign } : {}),
  };
}

export async function main(argv: readonly string[]): Promise<void> {
  const args = parseArgs(argv);
  if (args._cmd !== "build") {
    throw new Error('用法: pi-web build --id <extId> --api <range> --dir <.pi/web> --out <dir>');
  }
  if (
    args.id === undefined ||
    args.targetApiVersion === undefined ||
    args.entryDir === undefined ||
    args.outDir === undefined
  ) {
    throw new Error("缺少必填参数:--id / --api / --dir / --out");
  }
  const result = await buildWebExtension({
    id: args.id,
    targetApiVersion: args.targetApiVersion,
    entryDir: args.entryDir,
    outDir: args.outDir,
    ...(args.signKey !== undefined ? { signKey: args.signKey } : {}),
  });
  // eslint-disable-next-line no-console
  console.log(`[pi-web build] ${args.id} → ${result.entryOut} (integrity=${result.manifest.integrity})`);
}

// 作为脚本直接执行时运行(经 TS 运行时)。
const isDirect = process.argv[1] !== undefined && process.argv[1].endsWith("cli.ts");
if (isDirect) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
}

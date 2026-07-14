/**
 * installer — 原子写入器(spec cli-component-add,任务 2.6,Req 3.3, 3.4, 5.1, 5.3)。
 *
 * 不变量(design §installer):
 *   1. **落点门控**:destDir 及每个目标路径按「已存在祖先段 realpath + 剩余段拼接」
 *      解析后必须落在目标 source(realpath)内 —— 软链把落点指到 source 外时拒绝(3.3)。
 *   2. **staging-and-swap**:全部源文件字节先读入内存(读失败则一字节未写)→ 写入
 *      `.staging-<id>-<random>` → fresh 态直接 rename 进位;覆盖态旧目录先 rename
 *      `.bak`,swap 成功后删除;任何失败清 staging、还原 `.bak`(5.3)。
 *   3. **溯源同生**:`.component.json` 随 staging 一并写入,与文件集原子同生(5.2 联动)。
 *   4. **零执行**:本文件只做字节搬运,不 import/require/spawn 组件包内任何内容(3.4)。
 */
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { Result } from "../scaffold/scaffold-writer.js";
import { COMPONENT_PROVENANCE_FILENAME, sha256Hex, type ComponentProvenance } from "./provenance.js";

export type InstallWriteError = {
  readonly code: "dest_escapes_target" | "install_write_failed";
  readonly message: string;
};

export interface InstallFilesRequest {
  /** 组件包根(绝对路径)。files 相对它读取。 */
  readonly packRoot: string;
  /** 相对包根的源文件清单(已过 manifest-validate 的路径安全校验)。 */
  readonly files: readonly string[];
  /** 落点目录(绝对路径,`<targetSourceDir>/.pi/web/components/<id>`)。 */
  readonly destDir: string;
  /** 目标 agent source 根(绝对路径;realpath 门控的边界)。 */
  readonly targetSourceDir: string;
  /** 溯源记录(files 摘要由本函数计算并覆盖写入)。 */
  readonly provenance: Omit<ComponentProvenance, "files">;
  /** 测试注入:staging 写入完成后、swap 之前的故障点。 */
  readonly beforeSwapHook?: () => void;
}

export interface InstallFilesSuccess {
  /** 实际写入的相对路径(含溯源文件)。 */
  readonly written: readonly string[];
  readonly provenance: ComponentProvenance;
}

/** 解析「可能尚不存在」的路径:取已存在的最近祖先做 realpath,再拼回剩余段。 */
function resolveWithExistingAncestor(p: string): string {
  let base = p;
  const rest: string[] = [];
  while (!existsSync(base)) {
    rest.unshift(path.basename(base));
    const parent = path.dirname(base);
    if (parent === base) break;
    base = parent;
  }
  const real = existsSync(base) ? realpathSync(base) : base;
  return path.join(real, ...rest);
}

/** p 是否落在 root 内(边界含 root 自身之下,不含 root 本身)。 */
function isInside(p: string, root: string): boolean {
  const rel = path.relative(root, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function installComponentFiles(
  req: InstallFilesRequest,
): Result<InstallFilesSuccess, InstallWriteError> {
  const sourceRealRoot = resolveWithExistingAncestor(req.targetSourceDir);

  // —— 门控:destDir 与全部目标路径解析后必须在 source 内(Req 3.3)——
  const destResolved = resolveWithExistingAncestor(req.destDir);
  if (!isInside(destResolved, sourceRealRoot)) {
    return {
      ok: false,
      error: {
        code: "dest_escapes_target",
        message: `落点解析后逃出目标 source: ${req.destDir} → ${destResolved}`,
      },
    };
  }
  for (const rel of req.files) {
    const resolved = resolveWithExistingAncestor(path.join(req.destDir, rel));
    if (!isInside(resolved, sourceRealRoot)) {
      return {
        ok: false,
        error: {
          code: "dest_escapes_target",
          message: `目标文件解析后逃出目标 source: ${rel} → ${resolved}`,
        },
      };
    }
  }

  // —— 全部源字节先读入内存:读失败则一字节未写(Req 5.3)——
  const contents = new Map<string, Buffer>();
  for (const rel of req.files) {
    try {
      contents.set(rel, readFileSync(path.join(req.packRoot, rel)));
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "install_write_failed",
          message: `读取组件源文件失败: ${rel}(${(err as Error).message})`,
        },
      };
    }
  }
  const fileDigests: Record<string, string> = {};
  for (const [rel, bytes] of contents) fileDigests[rel.replaceAll("\\", "/")] = sha256Hex(bytes);
  const provenance: ComponentProvenance = { ...req.provenance, files: fileDigests };

  // —— staging-and-swap ——
  const parent = path.dirname(req.destDir);
  const stagingDir = path.join(
    parent,
    `.staging-${path.basename(req.destDir)}-${randomBytes(4).toString("hex")}`,
  );
  const bakDir = `${req.destDir}.bak-${randomBytes(4).toString("hex")}`;
  const hadExisting = existsSync(req.destDir);
  let bakMoved = false;
  try {
    mkdirSync(stagingDir, { recursive: true });
    for (const [rel, bytes] of contents) {
      const abs = path.join(stagingDir, rel);
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
    }
    writeFileSync(
      path.join(stagingDir, COMPONENT_PROVENANCE_FILENAME),
      `${JSON.stringify(provenance, null, 2)}\n`,
    );
    req.beforeSwapHook?.();
    if (hadExisting) {
      renameSync(req.destDir, bakDir);
      bakMoved = true;
    }
    renameSync(stagingDir, req.destDir);
    if (bakMoved) rmSync(bakDir, { recursive: true, force: true });
  } catch (err) {
    // 还原:清 staging;若旧目录已被挪走则还原(Req 5.3 —— 落点回到安装前状态)。
    rmSync(stagingDir, { recursive: true, force: true });
    if (bakMoved && !existsSync(req.destDir)) renameSync(bakDir, req.destDir);
    else if (bakMoved) rmSync(bakDir, { recursive: true, force: true });
    return {
      ok: false,
      error: {
        code: "install_write_failed",
        message: `写入组件文件失败,落点已还原: ${(err as Error).message}`,
      },
    };
  }

  const written = [...contents.keys(), COMPONENT_PROVENANCE_FILENAME].map((p2) =>
    p2.replaceAll("\\", "/"),
  );
  return { ok: true, value: { written, provenance } };
}

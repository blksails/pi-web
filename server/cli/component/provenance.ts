/**
 * provenance — `.component.json` 溯源记录与安装态判定(spec cli-component-add,
 * 任务 2.3,Req 5.2, 7.1–7.4)。
 *
 * 溯源记录本 spec 是唯一权威(design §Boundary):记录**安装时刻**的逐文件 sha256,
 * 用途仅是本地分叉检测(shadcn 式「拷完归你」车道的更新三态依据)——不是完整性签名,
 * 与 publish 车道的 sha384+Ed25519 明确区分、不共享实现(research §1.4)。
 *
 * 安装态判定为纯函数(读文件经注入的 `readFile` 回调),五态判别式可穷举单测:
 *   - `fresh`               落点目录不存在 → 首装;
 *   - `unmanaged`           目录在但无溯源 → 拒绝(被非本安装器管理的内容占用,7.4);
 *   - `modified`            任一记录文件缺失或 sha256 不一致 → diff 拒绝(7.3);
 *   - `clean-same-version`  全一致且来源版本相同 → no-op(7.2);
 *   - `clean-new-version`   全一致且来源版本不同 → 覆盖(7.1;含降级——源码车道以来源为准)。
 */
import { createHash } from "node:crypto";

export const COMPONENT_PROVENANCE_FILENAME = ".component.json";

export interface ComponentProvenance {
  readonly id: string;
  readonly version: string;
  /** 来源标识(本地=绝对路径;git=规范化 `git:host/path@ref[#subdir]`)。 */
  readonly origin: string;
  /** ISO 8601 安装时间。 */
  readonly installedAt: string;
  /** 包内相对路径(POSIX)→ `sha256:<hex>`。 */
  readonly files: Readonly<Record<string, string>>;
}

export function sha256Hex(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

/** 解析溯源 JSON;形状不合返回 null(视同 unmanaged,由调用方裁决)。 */
export function parseProvenance(text: string): ComponentProvenance | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o["id"] !== "string" ||
    typeof o["version"] !== "string" ||
    typeof o["origin"] !== "string" ||
    typeof o["installedAt"] !== "string" ||
    typeof o["files"] !== "object" ||
    o["files"] === null
  ) {
    return null;
  }
  const files: Record<string, string> = {};
  for (const [k, v] of Object.entries(o["files"] as Record<string, unknown>)) {
    if (typeof v !== "string") return null;
    files[k] = v;
  }
  return {
    id: o["id"],
    version: o["version"],
    origin: o["origin"],
    installedAt: o["installedAt"],
    files,
  };
}

export type InstallState =
  | { readonly state: "fresh" }
  | { readonly state: "clean-same-version"; readonly installed: ComponentProvenance }
  | { readonly state: "clean-new-version"; readonly installed: ComponentProvenance }
  | {
      readonly state: "modified";
      readonly installed: ComponentProvenance;
      /** 变更(含缺失)的相对路径表。 */
      readonly changed: readonly string[];
    }
  | { readonly state: "unmanaged" };

export interface ClassifyDeps {
  /** 落点目录是否存在。 */
  readonly destExists: (destDir: string) => boolean;
  /** 读落点内相对路径的文件字节;不存在返回 null。 */
  readonly readFile: (destDir: string, rel: string) => Uint8Array | null;
}

/**
 * 判定安装态(判定序见文件头)。`incoming.version` 为来源清单版本。
 * 溯源文件缺失或不可解析 → `unmanaged`(不猜,7.4)。
 */
export function classifyInstallState(
  destDir: string,
  incoming: { readonly version: string },
  deps: ClassifyDeps,
): InstallState {
  if (!deps.destExists(destDir)) return { state: "fresh" };

  const provBytes = deps.readFile(destDir, COMPONENT_PROVENANCE_FILENAME);
  const installed = provBytes === null ? null : parseProvenance(new TextDecoder().decode(provBytes));
  if (installed === null) return { state: "unmanaged" };

  const changed: string[] = [];
  for (const [rel, recorded] of Object.entries(installed.files)) {
    const bytes = deps.readFile(destDir, rel);
    // 记录中的文件在落点缺失视同修改(需求 7 判定序)。
    if (bytes === null || sha256Hex(bytes) !== recorded) changed.push(rel);
  }
  if (changed.length > 0) return { state: "modified", installed, changed };

  return incoming.version === installed.version
    ? { state: "clean-same-version", installed }
    : { state: "clean-new-version", installed };
}

/**
 * 上传域名审核文件 —— 解压压缩包后 scp 到 ab1 静态目录。
 *
 * 流程：
 *   1. 接收本地压缩包路径（zip / tar / tar.gz / tgz …）
 *   2. 解压到临时目录
 *   3. 选出待上传文件夹（单根目录则用该目录，否则用整包解压根）
 *   4. `scp -r <folder> ab1:~/ablink/public`
 *
 * 覆盖：
 *   - SENDACTION 风格 env：`ABLINK_SCP_REMOTE`（默认 `ab1:~/ablink/public`）
 *   - 真实上传必须 confirm=true
 */
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const DEFAULT_REMOTE = "ab1:~/ablink/public";

function resolveRemote(): string {
  return process.env.ABLINK_SCP_REMOTE?.trim() || DEFAULT_REMOTE;
}

function runCmd(
  cmd: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv },
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: opts?.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({
        code: 1,
        stdout,
        stderr: `${stderr}\nspawn error: ${err.message}`.trim(),
      });
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function shellQuote(a: string): string {
  return /\s|["'$`\\]/.test(a) ? JSON.stringify(a) : a;
}

/** 解析绝对/相对路径（相对 cwd）。 */
function resolveLocalPath(p: string): string {
  const t = p.trim();
  if (!t) return t;
  if (path.isAbsolute(t)) return path.normalize(t);
  return path.resolve(process.cwd(), t);
}

type ArchiveKind = "zip" | "tar" | "targz" | "tarbz2" | "rar";

function detectArchiveKind(filePath: string): ArchiveKind | null {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "targz";
  if (lower.endsWith(".tar.bz2") || lower.endsWith(".tbz2")) return "tarbz2";
  if (lower.endsWith(".tar")) return "tar";
  if (lower.endsWith(".zip")) return "zip";
  if (lower.endsWith(".rar")) return "rar";
  return null;
}

/**
 * 去掉常见压缩后缀得到包名（用于默认文件夹名）。
 * foo.bar.tar.gz → foo.bar；site.zip → site
 */
function archiveBaseName(filePath: string): string {
  let base = path.basename(filePath);
  const lower = base.toLowerCase();
  for (const ext of [".tar.gz", ".tar.bz2", ".tgz", ".tbz2", ".tar", ".zip", ".rar"]) {
    if (lower.endsWith(ext)) {
      base = base.slice(0, base.length - ext.length);
      break;
    }
  }
  return base || "upload";
}

async function extractArchive(
  archivePath: string,
  destDir: string,
  kind: ArchiveKind,
): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  mkdirSync(destDir, { recursive: true });
  let result: { code: number | null; stdout: string; stderr: string };
  switch (kind) {
    case "zip":
      // -o 覆盖；-q 安静。zip-slip 后续由 scp 源目录白名单约束（仅上传 destDir 内）。
      result = await runCmd("unzip", ["-o", "-q", archivePath, "-d", destDir]);
      break;
    case "tar":
      result = await runCmd("tar", ["-xf", archivePath, "-C", destDir]);
      break;
    case "targz":
      result = await runCmd("tar", ["-xzf", archivePath, "-C", destDir]);
      break;
    case "tarbz2":
      result = await runCmd("tar", ["-xjf", archivePath, "-C", destDir]);
      break;
    case "rar": {
      // 优先 unar / unrar / bsdtar
      const tryCmds: Array<[string, string[]]> = [
        ["unar", ["-o", destDir, "-f", archivePath]],
        ["unrar", ["x", "-o+", archivePath, destDir + "/"]],
        ["bsdtar", ["-xf", archivePath, "-C", destDir]],
      ];
      result = {
        code: 1,
        stdout: "",
        stderr: "无可用 rar 解压工具（需要 unar / unrar / bsdtar）",
      };
      for (const [cmd, args] of tryCmds) {
        const r = await runCmd(cmd, args);
        if (r.code === 0 || !r.stderr.includes("spawn error")) {
          result = r;
          if (r.code === 0) break;
        }
      }
      break;
    }
  }
  return {
    ok: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    code: result.code,
  };
}

/**
 * 决定 scp 源路径：
 * - 若解压后只有一个顶层目录 → 上传该目录（常见：包内带站点文件夹）
 * - 否则 → 上传整个解压根（会以 extract 目录名出现在远端 public 下）
 */
/**
 * 决定 scp 源路径：
 * - 解压后仅一个顶层目录 → 上传该目录
 * - 多文件 / 散落根文件 → 将解压根 rename 为包名再上传（远端 public/<包名>）
 */
function pickUploadFolder(extractRoot: string, preferredName: string): string {
  const entries = readdirSync(extractRoot);
  const meaningful = entries.filter(
    (n) => n !== "__MACOSX" && n !== ".DS_Store" && !n.startsWith(".__"),
  );
  if (meaningful.length === 1) {
    const only = path.join(extractRoot, meaningful[0]!);
    if (existsSync(only) && statSync(only).isDirectory()) {
      return only;
    }
  }
  const base = path.basename(extractRoot);
  if (base === preferredName) return extractRoot;
  const target = path.join(path.dirname(extractRoot), preferredName);
  if (existsSync(target)) return extractRoot;
  try {
    renameSync(extractRoot, target);
    return target;
  } catch {
    return extractRoot;
  }
}

export const uploadDomainReview = defineTool({
  name: "upload_domain_review",
  label: "上传域名审核文件",
  description:
    "解压本地域名审核压缩包（zip/tar/tar.gz 等），并 scp -r 上传到 ab1:~/ablink/public。" +
    "用户发来审核材料压缩包、要求上传域名审核文件、同步到 ablink/public 时使用。" +
    "真实上传必须 confirm=true；否则仅预览解压目标与 scp 命令。",
  parameters: Type.Object({
    archive: Type.Optional(
      Type.String({
        description:
          "本地压缩包路径（绝对路径或相对 cwd）。与 folder 二选一；收到压缩包时必填",
      }),
    ),
    folder: Type.Optional(
      Type.String({
        description:
          "已解压的本地文件夹路径。若用户已解压好，可直接 scp，跳过解压",
      }),
    ),
    remote: Type.Optional(
      Type.String({
        description: `scp 目标，默认 ${DEFAULT_REMOTE}（可用 env ABLINK_SCP_REMOTE 覆盖）`,
      }),
    ),
    confirm: Type.Optional(
      Type.Boolean({
        description:
          "必须为 true 才执行 scp 上传。false/省略 = 仅解压预览（或只打印命令）",
      }),
    ),
    keep_extract: Type.Optional(
      Type.Boolean({
        description: "为 true 时保留临时解压目录，默认上传成功后删除",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    const remote = params.remote?.trim() || resolveRemote();
    const confirm = params.confirm === true;

    const archivePath = params.archive?.trim()
      ? resolveLocalPath(params.archive)
      : "";
    const folderPath = params.folder?.trim()
      ? resolveLocalPath(params.folder)
      : "";

    if (!archivePath && !folderPath) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "需要 archive（压缩包路径）或 folder（已解压目录）。" +
              "例如：upload_domain_review({ archive: \"/path/to/review.zip\" })",
          },
        ],
        details: { ok: false as const, error: "need archive or folder" },
      };
    }

    let uploadSrc = "";
    let extractRoot: string | null = null;
    let extractLog = "";
    const cleanupDirs: string[] = [];

    try {
      if (folderPath) {
        if (!existsSync(folderPath) || !statSync(folderPath).isDirectory()) {
          return {
            content: [
              {
                type: "text" as const,
                text: `folder 不存在或不是目录：${folderPath}`,
              },
            ],
            details: { ok: false as const, error: "bad folder" },
          };
        }
        uploadSrc = folderPath;
      } else {
        if (!existsSync(archivePath) || !statSync(archivePath).isFile()) {
          return {
            content: [
              {
                type: "text" as const,
                text: `压缩包不存在或不是文件：${archivePath}`,
              },
            ],
            details: { ok: false as const, error: "bad archive" },
          };
        }
        const kind = detectArchiveKind(archivePath);
        if (!kind) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `无法识别压缩格式：${path.basename(archivePath)}\n` +
                  "支持：.zip .tar .tar.gz .tgz .tar.bz2 .rar",
              },
            ],
            details: { ok: false as const, error: "unknown archive kind" },
          };
        }

        const preferredName = archiveBaseName(archivePath);
        extractRoot = path.join(
          tmpdir(),
          `domain-review-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        );
        mkdirSync(extractRoot, { recursive: true });
        cleanupDirs.push(extractRoot);

        const extracted = await extractArchive(archivePath, extractRoot, kind);
        extractLog = [
          `解压: ${kind} → ${extractRoot}`,
          extracted.ok ? "解压成功" : `解压失败 exit=${extracted.code}`,
          extracted.stderr.trim() ? `stderr: ${extracted.stderr.trim()}` : "",
          extracted.stdout.trim() ? `stdout: ${extracted.stdout.trim()}` : "",
        ]
          .filter(Boolean)
          .join("\n");

        if (!extracted.ok) {
          return {
            content: [{ type: "text" as const, text: extractLog }],
            details: {
              ok: false as const,
              error: "extract failed",
              extractRoot,
            },
          };
        }

        uploadSrc = pickUploadFolder(extractRoot, preferredName);
        // pickUploadFolder 可能 rename 了 extractRoot
        if (uploadSrc !== extractRoot && existsSync(uploadSrc)) {
          cleanupDirs.push(uploadSrc);
        }
      }

      const topEntries = existsSync(uploadSrc)
        ? readdirSync(uploadSrc).slice(0, 30)
        : [];
      const cmdline = `scp -r ${shellQuote(uploadSrc)} ${shellQuote(remote)}`;

      if (!confirm) {
        const text = [
          "【预览】未执行 scp（confirm≠true）。确认无误后请带 confirm: true 再调一次。",
          archivePath ? `压缩包: ${archivePath}` : "",
          extractLog || "",
          `待上传目录: ${uploadSrc}`,
          topEntries.length
            ? `目录内容(最多 30): ${topEntries.join(", ")}`
            : "(目录为空?)",
          `远端: ${remote}`,
          `将执行: ${cmdline}`,
          "说明: scp -r 会把文件夹放到 public 下（如 public/<文件夹名>/…）",
        ]
          .filter(Boolean)
          .join("\n");
        return {
          content: [{ type: "text" as const, text }],
          details: {
            ok: true as const,
            dry_run: true as const,
            archive: archivePath || null,
            uploadSrc,
            remote,
            cmdline,
            topEntries,
          },
        };
      }

      // 真实上传：BatchMode 避免交互挂起；依赖本机 ~/.ssh/config 的 Host ab1
      const scpArgs = [
        "-r",
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=accept-new",
        uploadSrc,
        remote,
      ];
      const scpCmdline = `scp ${scpArgs.map(shellQuote).join(" ")}`;
      const scp = await runCmd("scp", scpArgs);

      const ok = scp.code === 0;
      const text = [
        ok ? "✓ 域名审核文件上传完成" : `✗ scp 失败 exit=${scp.code}`,
        archivePath ? `压缩包: ${archivePath}` : "",
        extractLog || "",
        `本地目录: ${uploadSrc}`,
        `远端: ${remote}`,
        `命令: ${scpCmdline}`,
        scp.stderr.trim() ? `--- stderr ---\n${scp.stderr.trim()}` : "",
        scp.stdout.trim() ? `--- stdout ---\n${scp.stdout.trim()}` : "",
        ok
          ? "远端路径形如：~/ablink/public/<文件夹名>/"
          : "请检查 Host ab1 / SSH 密钥 / 远端目录权限。",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text }],
        details: {
          ok,
          archive: archivePath || null,
          uploadSrc,
          remote,
          cmdline: scpCmdline,
          code: scp.code,
        },
      };
    } finally {
      if (!params.keep_extract) {
        for (const d of cleanupDirs) {
          try {
            if (existsSync(d)) rmSync(d, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
  },
});

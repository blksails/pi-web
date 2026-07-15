/**
 * phonegen 工具 —— 包装本机真实 CLI：
 *   /Users/hysios/Projects/phonegen/main.py
 *
 * 号段数据（phone.dic 等）与生成逻辑都在该目录；本工具只负责参数校验、
 * 以正确 cwd 调 `python3 main.py`，并把 stdout/落盘路径回传给 agent。
 *
 * 覆盖根目录：env `PHONEGEN_ROOT`（默认 `/Users/hysios/Projects/phonegen`）。
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const DEFAULT_ROOT = "/Users/hysios/Projects/phonegen";

/** 控制台预览时限制回传体积：大批量必须 -o 落盘。 */
const MAX_INLINE_COUNT = 200;

function resolveRoot(): string {
  return process.env.PHONEGEN_ROOT?.trim() || DEFAULT_ROOT;
}

function runPython(
  root: string,
  args: string[],
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("python3", args, {
      cwd: root,
      env: process.env,
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

export const phonegen = defineTool({
  name: "phonegen",
  label: "号码生成 (phonegen CLI)",
  description:
    "调用本机 phonegen 项目生成手机号（按省/市/运营商号段）。" +
    "等价于在 /Users/hysios/Projects/phonegen 下执行 `python3 main.py …`。" +
    "支持 province/city/operator、random|sequence、shuffle、输出文件与分片。" +
    "大批量请指定 output 落盘，勿只打控制台。",
  parameters: Type.Object({
    province: Type.Optional(
      Type.String({ description: "省份，如 湖南、上海、北京" }),
    ),
    city: Type.Optional(
      Type.String({ description: "城市，如 合肥、广州（可选）" }),
    ),
    operator: Type.Optional(
      Type.String({ description: "运营商：移动 / 联通 / 电信" }),
    ),
    count: Type.Optional(
      Type.Integer({
        minimum: 1,
        description:
          "生成数量。random 默认 10；sequence 不指定则按号段尽量生成（极大），大批量务必配合 output。",
      }),
    ),
    mode: Type.Optional(
      Type.Union([Type.Literal("random"), Type.Literal("sequence")], {
        description: "random=随机，sequence=顺序。默认 sequence（与 CLI 一致）。",
      }),
    ),
    shuffle: Type.Optional(
      Type.Boolean({ description: "是否对结果全局乱序（CLI -s）" }),
    ),
    shuffleChunks: Type.Optional(
      Type.Boolean({
        description: "分片写入时是否对每个分片内部乱序（CLI --shuffle-chunks）",
      }),
    ),
    output: Type.Optional(
      Type.String({
        description:
          "输出文件路径。相对路径相对于 phonegen 根目录；绝对路径原样使用。" +
          "超过 limit 行会自动分片为 name_1.ext …",
      }),
    ),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "单文件最大行数（CLI -l），默认沿用 CLI（10000000）",
      }),
    ),
    files: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "号段 dic 文件列表，相对 phonegen 根。默认 phone.dic（可加 phone1.dic）",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    const root = resolveRoot();
    const mainPy = path.join(root, "main.py");
    if (!existsSync(mainPy)) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `phonegen 根目录无效：找不到 ${mainPy}\n` +
              `请确认项目在 ${DEFAULT_ROOT}，或设置 env PHONEGEN_ROOT。`,
          },
        ],
        details: { ok: false as const, root, error: "main.py missing" },
      };
    }

    const mode = params.mode ?? "sequence";
    const count = params.count;

    // 无 output 时限制 count，避免 sequence 全量刷爆 stdout / 内存。
    if (!params.output) {
      if (mode === "sequence" && count === undefined) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                "安全限制：sequence 模式且未指定 count 时必须提供 output 落盘，" +
                "否则会生成海量号码。请加 count 或 output。",
            },
          ],
          details: { ok: false as const, error: "need count or output" },
        };
      }
      if (count !== undefined && count > MAX_INLINE_COUNT) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `安全限制：不落盘时 count 最大 ${MAX_INLINE_COUNT}（当前 ${count}）。` +
                `请设置 output 写文件，或减小 count。`,
            },
          ],
          details: { ok: false as const, error: "count too large without output" },
        };
      }
    }

    const args: string[] = ["main.py"];
    if (params.province) args.push("-p", params.province);
    if (params.city) args.push("-c", params.city);
    if (params.operator) args.push("--op", params.operator);
    if (count !== undefined) args.push("-n", String(count));
    args.push("-m", mode);
    if (params.shuffle) args.push("-s");
    if (params.shuffleChunks) args.push("--shuffle-chunks");
    if (params.limit !== undefined) args.push("-l", String(params.limit));
    if (params.files && params.files.length > 0) {
      args.push("-f", ...params.files);
    }
    if (params.output) {
      // 相对路径保持相对 root（CLI cwd=root）；绝对路径原样。
      args.push("-o", params.output);
    }

    const cmdline = `cd ${root} && python3 ${args
      .map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))
      .join(" ")}`;

    const { code, stdout, stderr } = await runPython(root, args);
    const ok = code === 0;
    const text = [
      ok ? "phonegen 执行完成" : `phonegen 退出码 ${code}`,
      `根目录: ${root}`,
      `命令: ${cmdline}`,
      stderr.trim() ? `--- stderr ---\n${stderr.trim()}` : "",
      stdout.trim() ? `--- stdout ---\n${stdout.trim()}` : "(无 stdout)",
      params.output
        ? `输出参数: ${params.output}（相对路径在 ${root} 下；超限会分片 *_1,*_2…）`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text" as const, text }],
      details: {
        ok,
        root,
        code,
        cmdline,
        stdout,
        stderr,
        output: params.output ?? null,
      },
    };
  },
});

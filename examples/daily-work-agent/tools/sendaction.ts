/**
 * sendaction 工具 —— 包装本机腾讯广告手动回传 CLI：
 *   /Users/hysios/Projects/hnhuaxi/utils/sendaction
 *
 * 等价于在该目录执行 `go run . -mode N -click_id=… -link=…`（见 send.sh / send3.sh）。
 * 覆盖根目录：env `SENDACTION_ROOT`。
 *
 * 安全：
 * - 真实回传必须 confirm=true（广告平台侧有计费/优化影响，不可撤销）。
 * - 从目录内 .env / .env.<accountId> 注入 GDT_ACCESS_TOKEN 等，绝不回显 token。
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const DEFAULT_ROOT = "/Users/hysios/Projects/hnhuaxi/utils/sendaction";
/** 默认投放 link（mode 2/3/5）；可用参数 `link` 或 env `SENDACTION_LINK` 覆盖。 */
const DEFAULT_LINK = "https://pub.wdshquan.top";

/** 回传模式说明（与 main.go switch 对齐） */
const MODE_HELP = {
  0: "callback URL POST（需 callback）",
  1: "Marketing API UserActions.Add（需 click_id + GDT_ACCESS_TOKEN + account）",
  2: "Web 转化 GET tracking.e.qq.com/conv/web（需 click_id + link）— 日常最常用",
  3: "Web 转化 POST tracking.e.qq.com/conv（需 click_id + link，可选 action_params）",
  4: "微信转化 POST（需 click_id + wechat appid，可选 action_params）",
  5: "Marketing API v3 UserActions.Add（需 click_id + link + GDT_ACCESS_TOKEN）",
} as const;

type Mode = 0 | 1 | 2 | 3 | 4 | 5;

function resolveRoot(): string {
  return process.env.SENDACTION_ROOT?.trim() || DEFAULT_ROOT;
}

function resolveDefaultLink(): string {
  return process.env.SENDACTION_LINK?.trim() || DEFAULT_LINK;
}

/** 解析 dotenv 风格 KEY=VALUE（忽略注释与空行；值可带引号）。 */
function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * 选择 env 文件：
 * - 显式 envFile（相对 root 或绝对路径）
 * - accountId → 优先 `.env.<accountId>`，否则 `.env`
 * - 默认 `.env`
 */
function resolveEnvFile(
  root: string,
  envFile?: string,
  accountId?: number,
): { path: string | null; vars: Record<string, string> } {
  const candidates: string[] = [];
  if (envFile?.trim()) {
    const p = path.isAbsolute(envFile)
      ? envFile
      : path.join(root, envFile.trim());
    candidates.push(p);
  }
  if (accountId !== undefined && Number.isFinite(accountId)) {
    candidates.push(path.join(root, `.env.${accountId}`));
  }
  candidates.push(path.join(root, ".env"));

  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return { path: p, vars: parseDotEnv(readFileSync(p, "utf8")) };
      } catch {
        /* try next */
      }
    }
  }
  return { path: null, vars: {} };
}

/** 列出 root 下可用的 `.env*` 账号文件（仅文件名，不含内容）。 */
function listAccountEnvFiles(root: string): string[] {
  try {
    return readdirSync(root)
      .filter((n) => n === ".env" || /^\.env\.\w+$/.test(n))
      .sort();
  } catch {
    return [];
  }
}

function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) {
    if (s && s.length >= 6) {
      out = out.split(s).join("[REDACTED]");
    }
  }
  // 兜底：常见 token 形态
  out = out.replace(/GDT_ACCESS_TOKEN=\S+/gi, "GDT_ACCESS_TOKEN=[REDACTED]");
  return out;
}

function runGo(
  root: string,
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    // 临时产物落到沙盒 allowWrite：/tmp + GOCACHE（与 .pi/sandbox.json 对齐）。
    const defaultGoCache = path.join(homedir(), "Library/Caches/go-build");
    const childEnv: NodeJS.ProcessEnv = {
      ...env,
      GOTMPDIR: env.GOTMPDIR || "/tmp",
      TMPDIR: env.TMPDIR || "/tmp",
      GOCACHE: env.GOCACHE || defaultGoCache,
    };
    // go run . <flags…>
    const child = spawn("go", ["run", ".", ...args], {
      cwd: root,
      env: childEnv,
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

export const sendaction = defineTool({
  name: "sendaction",
  label: "手动回传 (sendaction CLI)",
  description:
    "调用本机 hnhuaxi/utils/sendaction 对腾讯广告做手动转化回传。" +
    "等价于 `cd …/sendaction && go run . -mode N -click_id=… -link=…`。" +
    "常用 mode=2（Web GET）/ mode=3（Web POST）。" +
    "默认 link=https://pub.wdshquan.top（可传 link 或 env SENDACTION_LINK 覆盖）。" +
    "真实回传必须 confirm=true；confirm=false 只预览将执行的命令。" +
    "支持 list_accounts 列出可用 .env 账号文件。",
  parameters: Type.Object({
    list_accounts: Type.Optional(
      Type.Boolean({
        description:
          "为 true 时仅列出 SENDACTION_ROOT 下可用的 .env / .env.<id> 文件名，不执行回传",
      }),
    ),
    mode: Type.Optional(
      Type.Integer({
        minimum: 0,
        maximum: 5,
        description:
          "回传模式 0–5。默认 2。" +
          "0=callback POST；1=API；2=Web GET（常用）；3=Web POST；4=微信；5=API v3",
      }),
    ),
    click_id: Type.Optional(
      Type.String({
        description: "单个 click_id（模式 1–5 必需）。批量请用 click_ids",
      }),
    ),
    click_ids: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "批量 click_id，按序串行回传（每条独立 go run）。与 click_id 二选一，都有时合并去重",
      }),
    ),
    link: Type.Optional(
      Type.String({
        description:
          "投放落地页完整 URL（mode 2/3/5）。省略时默认 https://pub.wdshquan.top（可用 env SENDACTION_LINK 覆盖）。CLI 会取 host 作为 link 参数",
      }),
    ),
    action_type: Type.Optional(
      Type.String({
        description:
          "行为类型，默认 RESERVATION。常用：RESERVATION / REGISTER / PURCHASE / COMPLETE_ORDER / CONFIRM_EFFECTIVE_LEADS / DELIVER 等",
      }),
    ),
    action_params: Type.Optional(
      Type.String({
        description:
          'JSON 字符串，传给 -action_params（mode 3/4/5）。例：{"value":100}',
      }),
    ),
    callback: Type.Optional(
      Type.String({ description: "mode=0 的 callback URL（可 URL-encoded）" }),
    ),
    wechat: Type.Optional(
      Type.String({ description: "mode=4 的微信 AppID（-wechat）" }),
    ),
    imei: Type.Optional(
      Type.String({ description: "mode=0 可用：用户 hash_imei（-imei）" }),
    ),
    account_id: Type.Optional(
      Type.Integer({
        description:
          "广告账户 ID（-account_id）。若目录有 .env.<id> 会优先加载；也可从 env 文件 ACCOUNT_ID 读取",
      }),
    ),
    user_action_set_id: Type.Optional(
      Type.Integer({
        description:
          "用户行为数据源 ID（-user_action_set_id）。可从 env 文件 USER_ACTION_SET_ID 读取",
      }),
    ),
    env_file: Type.Optional(
      Type.String({
        description:
          "显式 env 文件：相对 SENDACTION_ROOT 的路径（如 .env.74）或绝对路径。用于切换账号 token",
      }),
    ),
    confirm: Type.Optional(
      Type.Boolean({
        description:
          "必须为 true 才真正调用 go run 回传。false/省略 = 仅预览命令与参数（安全闸）",
      }),
    ),
  }),
  async execute(_toolCallId, params) {
    const root = resolveRoot();
    const mainGo = path.join(root, "main.go");

    if (params.list_accounts) {
      if (!existsSync(root)) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `sendaction 根目录不存在：${root}\n` +
                `请确认路径或设置 env SENDACTION_ROOT。`,
            },
          ],
          details: { ok: false as const, root, error: "root missing" },
        };
      }
      const files = listAccountEnvFiles(root);
      const text = [
        "可用账号 env 文件（仅文件名，不含密钥）：",
        files.length ? files.map((f) => `- ${f}`).join("\n") : "(无 .env*)",
        `根目录: ${root}`,
        `用法：sendaction({ env_file: ".env.74", mode: 2, click_id: "…", confirm: true })` +
          `\n默认 link: ${resolveDefaultLink()}`,
      ].join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: { ok: true as const, root, files },
      };
    }

    if (!existsSync(mainGo)) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              `sendaction 根目录无效：找不到 ${mainGo}\n` +
              `请确认项目在 ${DEFAULT_ROOT}，或设置 env SENDACTION_ROOT。`,
          },
        ],
        details: { ok: false as const, root, error: "main.go missing" },
      };
    }

    const mode = (params.mode ?? 2) as Mode;
    if (mode < 0 || mode > 5) {
      return {
        content: [
          {
            type: "text" as const,
            text: `无效 mode=${mode}。合法 0–5。\n${Object.entries(MODE_HELP)
              .map(([k, v]) => `  ${k}: ${v}`)
              .join("\n")}`,
          },
        ],
        details: { ok: false as const, error: "bad mode" },
      };
    }

    const ids: string[] = [];
    if (params.click_id?.trim()) ids.push(params.click_id.trim());
    if (params.click_ids?.length) {
      for (const id of params.click_ids) {
        const t = id?.trim();
        if (t) ids.push(t);
      }
    }
    const clickIds = [...new Set(ids)];

    // 参数校验（按 mode）
    if (mode === 0) {
      if (!params.callback?.trim()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "mode=0 需要 callback URL。",
            },
          ],
          details: { ok: false as const, error: "need callback" },
        };
      }
    } else if (clickIds.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: `mode=${mode} 需要 click_id 或 click_ids。`,
          },
        ],
        details: { ok: false as const, error: "need click_id" },
      };
    }

    const link =
      params.link?.trim() ||
      ((mode === 2 || mode === 3 || mode === 5) ? resolveDefaultLink() : undefined);

    if (mode === 4 && !params.wechat?.trim()) {
      return {
        content: [
          {
            type: "text" as const,
            text: "mode=4 需要 wechat（微信 AppID）。",
          },
        ],
        details: { ok: false as const, error: "need wechat" },
      };
    }

    if (params.action_params?.trim()) {
      try {
        JSON.parse(params.action_params);
      } catch {
        return {
          content: [
            {
              type: "text" as const,
              text: "action_params 必须是合法 JSON 字符串。",
            },
          ],
          details: { ok: false as const, error: "bad action_params json" },
        };
      }
    }

    const { path: envPath, vars: fileEnv } = resolveEnvFile(
      root,
      params.env_file,
      params.account_id,
    );

    const accountId =
      params.account_id ??
      (fileEnv.ACCOUNT_ID ? Number(fileEnv.ACCOUNT_ID) : undefined);
    const userActionSetId =
      params.user_action_set_id ??
      (fileEnv.USER_ACTION_SET_ID
        ? Number(fileEnv.USER_ACTION_SET_ID)
        : undefined);

    const actionType = params.action_type?.trim() || "RESERVATION";

    /** 构建单次 CLI flags（不含 go run .） */
    function buildArgs(clickId?: string): string[] {
      const args: string[] = [`-mode=${mode}`, `-action_type=${actionType}`];
      if (clickId) args.push(`-click_id=${clickId}`);
      if (link) args.push(`-link=${link}`);
      if (params.callback?.trim())
        args.push(`-callback=${params.callback.trim()}`);
      if (params.wechat?.trim()) args.push(`-wechat=${params.wechat.trim()}`);
      if (params.imei?.trim()) args.push(`-imei=${params.imei.trim()}`);
      if (params.action_params?.trim())
        args.push(`-action_params=${params.action_params.trim()}`);
      if (accountId !== undefined && Number.isFinite(accountId) && accountId > 0)
        args.push(`-account_id=${accountId}`);
      if (
        userActionSetId !== undefined &&
        Number.isFinite(userActionSetId) &&
        userActionSetId > 0
      )
        args.push(`-user_action_set_id=${userActionSetId}`);
      return args;
    }

    const previewTargets =
      mode === 0 ? ["(callback)"] : clickIds.length ? clickIds : ["(none)"];
    const previewCmdlines = previewTargets.map((cid) => {
      const args = buildArgs(mode === 0 ? undefined : cid);
      return `cd ${root} && go run . ${args.map(shellQuote).join(" ")}`;
    });

    const confirm = params.confirm === true;
    if (!confirm) {
      const text = [
        "【预览】未执行回传（confirm≠true）。确认无误后请带 confirm: true 再调一次。",
        `根目录: ${root}`,
        `mode: ${mode} — ${MODE_HELP[mode]}`,
        `action_type: ${actionType}`,
        `click_id(s): ${mode === 0 ? "(n/a)" : clickIds.join(", ") || "(空)"}`,
        link
          ? `link: ${link}${params.link?.trim() ? "" : "（默认）"}`
          : "",
        accountId !== undefined ? `account_id: ${accountId}` : "",
        userActionSetId !== undefined
          ? `user_action_set_id: ${userActionSetId}`
          : "",
        envPath ? `env 文件: ${path.basename(envPath)}` : "env 文件: (未找到 .env)",
        "--- 将执行 ---",
        ...previewCmdlines,
      ]
        .filter(Boolean)
        .join("\n");
      return {
        content: [{ type: "text" as const, text }],
        details: {
          ok: true as const,
          dry_run: true as const,
          root,
          mode,
          clickIds,
          link: link ?? null,
          cmdlines: previewCmdlines,
          envFile: envPath ? path.basename(envPath) : null,
        },
      };
    }

    // 注入 env：process.env + 文件（文件不覆盖已显式 export 的 GDT_ACCESS_TOKEN 时优先文件？）
    // 约定：工具参数 env_file / 目录 .env 覆盖当前进程，便于切账号。
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      ...fileEnv,
    };
    // 保证 GDT token 从文件带上（mode 1/5）
    if (fileEnv.GDT_ACCESS_TOKEN) {
      childEnv.GDT_ACCESS_TOKEN = fileEnv.GDT_ACCESS_TOKEN;
    }

    const secrets = [fileEnv.GDT_ACCESS_TOKEN, process.env.GDT_ACCESS_TOKEN]
      .filter((s): s is string => Boolean(s && s.length > 0));

    const results: Array<{
      clickId: string;
      code: number | null;
      ok: boolean;
      stdout: string;
      stderr: string;
      cmdline: string;
    }> = [];

    const targets = mode === 0 ? [""] : clickIds;
    for (const cid of targets) {
      const args = buildArgs(mode === 0 ? undefined : cid);
      const cmdline = `cd ${root} && go run . ${args.map(shellQuote).join(" ")}`;
      const { code, stdout, stderr } = await runGo(root, args, childEnv);
      results.push({
        clickId: cid || "(callback)",
        code,
        ok: code === 0,
        stdout: redactSecrets(stdout, secrets),
        stderr: redactSecrets(stderr, secrets),
        cmdline,
      });
    }

    const allOk = results.every((r) => r.ok);
    const blocks = results.map((r, i) => {
      const head = results.length > 1 ? `[${i + 1}/${results.length}] click_id=${r.clickId}` : `click_id=${r.clickId}`;
      return [
        r.ok ? `✓ ${head} 回传完成` : `✗ ${head} 退出码 ${r.code}`,
        `命令: ${r.cmdline}`,
        r.stderr.trim() ? `--- stderr ---\n${r.stderr.trim()}` : "",
        r.stdout.trim() ? `--- stdout ---\n${r.stdout.trim()}` : "(无 stdout)",
      ]
        .filter(Boolean)
        .join("\n");
    });

    const text = [
      allOk
        ? `sendaction 回传完成（${results.length} 条）`
        : `sendaction 部分/全部失败（成功 ${results.filter((r) => r.ok).length}/${results.length}）`,
      `根目录: ${root}`,
      `mode: ${mode} — ${MODE_HELP[mode]}`,
      `action_type: ${actionType}`,
      envPath ? `env 文件: ${path.basename(envPath)}` : "",
      "",
      ...blocks,
    ]
      .filter((l) => l !== undefined)
      .join("\n");

    return {
      content: [{ type: "text" as const, text }],
      details: {
        ok: allOk,
        root,
        mode,
        actionType,
        clickIds,
        link: link ?? null,
        envFile: envPath ? path.basename(envPath) : null,
        results: results.map((r) => ({
          clickId: r.clickId,
          ok: r.ok,
          code: r.code,
          cmdline: r.cmdline,
        })),
      },
    };
  },
});

/**
 * `.env` 文件加载(side-effect 模块,必须在任何读 env 的模块之前 import)。
 *
 * 旧宿主由 Next **内置**加载 `.env.local` / `.env`;脱离 Next 后这层能力随之消失 ——
 * 用户的 provider 密钥、`NEXT_PUBLIC_*` 门控、`PI_WEB_*` 配置会在 `pnpm dev` 与
 * `pi-web` 下静默全部失效。既有 e2e 抓不到:它们都显式传 env。
 *
 * 语义与 Next 对齐:
 *  - 加载顺序 `.env` → `.env.local`(后者覆盖前者);
 *  - **真实进程 env 优先** —— 已存在的键不被文件覆盖(CLI 的 `-p`、CI 的注入不会被顶掉);
 *  - 文件缺失是正常情况,静默跳过。
 *
 * 解析用 Node 内置 `util.parseEnv`(不引第三方 dotenv)。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseEnv } from "node:util";

/** 越靠后优先级越高(与 Next 一致:`.env.local` 覆盖 `.env`)。 */
const FILES = [".env", ".env.local"] as const;

export function loadEnvFiles(cwd: string = process.cwd()): readonly string[] {
  const loaded: string[] = [];
  // 先在文件之间合并(后者覆盖前者),**再**一次性填充 process.env。
  // 分两步是必要的:若边读边写,`.env` 写入的键会被「已存在则跳过」规则挡住
  // `.env.local` 的覆盖 —— 那会让 `.env.local` 形同虚设。
  const merged: Record<string, string> = {};

  for (const name of FILES) {
    let raw: string;
    try {
      raw = readFileSync(join(cwd, name), "utf8");
    } catch {
      continue; // 文件不存在 —— 正常
    }
    try {
      Object.assign(merged, parseEnv(raw) as Record<string, string>);
    } catch {
      process.stderr.write(`[pi-web] ${name} 解析失败,已跳过\n`);
      continue;
    }
    loaded.push(name);
  }

  for (const [key, value] of Object.entries(merged)) {
    // 真实进程 env 优先:CLI 的 `-p`、CI 注入不会被文件顶掉。
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return loaded;
}

loadEnvFiles();

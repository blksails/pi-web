/**
 * system-resource-args — 据「扩展」面板的 `loadSystemResources` 开关,推导建会话时注入
 * agent 进程的额外 argv。
 *
 * 默认载入系统(全局)skills/extensions(settings.json 中该键缺省 / 非 `false`);仅显式
 * `false` 时返回 `--no-skills --no-extensions` → agent 只载入项目 `<cwd>/.pi/` 资源。
 * 项目 `<cwd>/.pi/settings.json` 覆盖全局 `<agentDir>/settings.json`。读失败按"默认载入"
 * 处理(不致命)。纯 fs/path,不引 pi SDK,便于单测。
 */
import { promises as fs } from "node:fs";
import path from "node:path";

/** 读 JSON 对象;不存在 / 解析失败 / 非对象 → undefined(best-effort)。 */
async function readJsonObject(
  filePath: string,
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
    return parsed !== null && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/** 项目优先、全局兜底地解析 `loadSystemResources`(默认 true);仅显式 false 视为关闭。 */
function pickLoadSystemResources(
  project: Record<string, unknown> | undefined,
  global: Record<string, unknown> | undefined,
): boolean {
  if (project !== undefined && "loadSystemResources" in project) {
    return project["loadSystemResources"] !== false;
  }
  if (global !== undefined && "loadSystemResources" in global) {
    return global["loadSystemResources"] !== false;
  }
  return true;
}

/**
 * 计算注入 agent 的额外 argv:开关关闭 → `["--no-skills", "--no-extensions"]`,否则 `[]`。
 * @param agentDir 全局 pi 配置目录(`<agentDir>/settings.json`)。
 * @param cwd      会话工作目录(`<cwd>/.pi/settings.json` 为项目级覆盖)。
 */
export async function systemResourceArgs(
  agentDir: string,
  cwd: string,
): Promise<readonly string[]> {
  const [project, global] = await Promise.all([
    readJsonObject(path.join(cwd, ".pi", "settings.json")),
    readJsonObject(path.join(agentDir, "settings.json")),
  ]);
  return pickLoadSystemResources(project, global)
    ? []
    : ["--no-skills", "--no-extensions"];
}

/**
 * trust-store —— pi 项目信任库的**独立**读写实现(node:fs only,零 pi SDK 依赖)。
 *
 * 目的:解耦 trust 策略与 `@earendil-works/pi-coding-agent`。原实现值导入 SDK 的
 * `ProjectTrustStore` / `getAgentDir`,使 trust(在 Next 主进程被引用)把整套 pi SDK
 * (含 pi-ai 的 node:fs/os/path + 表达式 require)拽进路由 bundle。这里**依赖文件格式
 * 而非依赖包**:精确复刻 pi 的磁盘契约,保持与 pi CLI 共享同一 `~/.pi/agent/trust.json`。
 *
 * 复刻自 pi 0.79.6 `core/trust-manager.ts` + `utils/paths.ts` + `config.ts`:
 *   - 文件:`<agentDir>/trust.json`,形如 `{ [canonicalPath]: true | false | null }`
 *   - get(cwd):从 `normalizeCwd(cwd)` 沿目录树**向上找最近祖先**的 true/false 条目
 *   - set(cwd, d):key = `normalizeCwd(cwd)`;`null` 删除;写时 key 排序 + 2 空格 + 末尾换行
 *   - normalizeCwd = `realpathSync(resolve(cwd))`(realpath 失败回退解析路径)
 *   - getAgentDir = env `PI_CODING_AGENT_DIR`(展开 `~` / `file://`)否则 `~/.pi/agent`
 *
 * 与 pi 的差异(刻意):不引入 `proper-lockfile`;写用 temp+rename 原子替换(best-effort,
 * 与原 `makeProjectTrustPolicy` 的写库语义一致——失败不抛、不阻断建会话)。真·并发场景下
 * 与 pi CLI 同时写为 last-writer-wins(无文件损坏),可接受。
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve as nodeResolve } from "node:path";
import { fileURLToPath } from "node:url";

export type TrustValue = boolean | null;
type TrustData = Record<string, TrustValue>;

/** pi 默认配置目录名(pkg.piConfig.configDir,默认 `.pi`)。 */
const CONFIG_DIR_NAME = ".pi";
/** agentDir 覆盖环境变量(APP_NAME=pi → `PI_CODING_AGENT_DIR`)。 */
const ENV_AGENT_DIR = "PI_CODING_AGENT_DIR";

/** 复刻 pi `normalizePath`(默认 options:展开 `~` 与 `file://`)。 */
function normalizePath(input: string): string {
  const home = homedir();
  if (input === "~") return home;
  if (input.startsWith("~/") || (process.platform === "win32" && input.startsWith("~\\"))) {
    return join(home, input.slice(2));
  }
  if (/^file:\/\//.test(input)) return fileURLToPath(input);
  return input;
}

/** 复刻 pi `resolvePath`(归一化后绝对化)。 */
function resolvePath(input: string, baseDir: string = process.cwd()): string {
  const normalized = normalizePath(input);
  const base = normalizePath(baseDir);
  return isAbsolute(normalized) ? nodeResolve(normalized) : nodeResolve(base, normalized);
}

/** 复刻 pi `canonicalizePath`(realpath,失败回退原路径)。 */
function canonicalizePath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

function normalizeCwd(cwd: string): string {
  return canonicalizePath(resolvePath(cwd));
}

/** 复刻 pi `getAgentDir`:env 覆盖否则 `~/<.pi>/agent`。尊重 `PI_CODING_AGENT_DIR`。 */
export function getAgentDir(): string {
  const envDir = process.env[ENV_AGENT_DIR];
  if (envDir) return normalizePath(envDir);
  return join(homedir(), CONFIG_DIR_NAME, "agent");
}

function readTrustFile(path: string): TrustData {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read trust store ${path}: ${message}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid trust store ${path}: expected an object`);
  }
  const data: TrustData = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(
        `Invalid trust store ${path}: value for ${JSON.stringify(key)} must be true, false, or null`,
      );
    }
    data[key] = value;
  }
  return data;
}

/** 排序 key + 2 空格 + 末尾换行,temp+rename 原子写(与 pi 文件字节一致)。 */
function writeTrustFile(path: string, data: TrustData): void {
  const sorted: TrustData = {};
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value === true || value === false || value === null) sorted[key] = value;
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
  renameSync(tmp, path);
}

/** 沿目录树向上找最近的 true/false 条目(分层信任)。 */
function findNearestDecision(data: TrustData, cwd: string): TrustValue {
  let currentDir = normalizeCwd(cwd);
  for (;;) {
    const value = data[currentDir];
    if (value === true || value === false) return value;
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

/**
 * pi `ProjectTrustStore` 的零依赖等价实现。构造接收 agentDir,信任文件为
 * `<agentDir>/trust.json`(与 pi CLI 共享)。
 */
export class FsProjectTrustStore {
  private readonly trustPath: string;

  constructor(agentDir: string) {
    this.trustPath = join(resolvePath(agentDir), "trust.json");
  }

  /** 最近祖先决策(true|false),无则 null。 */
  get(cwd: string): TrustValue {
    const data = readTrustFile(this.trustPath);
    return findNearestDecision(data, cwd);
  }

  /** 设置某目录决策;`null` 删除该精确条目。 */
  set(cwd: string, decision: TrustValue): void {
    const data = readTrustFile(this.trustPath);
    const key = normalizeCwd(cwd);
    if (decision === null) delete data[key];
    else data[key] = decision;
    writeTrustFile(this.trustPath, data);
  }
}

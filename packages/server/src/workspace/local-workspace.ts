/**
 * 本地文件系统参照实现(spec: host-contract-ports,任务 4.1 + 4.2;
 * Req 1.7/1.8/2.1-2.9/3.4/3.5)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3(尤其 §3.2 第 5、6 条与 §3.2.1)
 * 与 design.md「LocalWorkspace(参照实现)」。
 *
 * 本文件落地:
 *  - **单个命名空间**(任务 4.1 + 4.2):键映射、读写合并、原子写入(同目录 temp + rename)、
 *    目录 0700 / 文件 0600、写时上限校验、以及「值与分组不可同址」;
 *  - **双根装配**(任务 4.3):{@link createLocalWorkspace} 以两个各自独立的根装配
 *    `user` / `project`,并接通上限的三段式 env 契约。
 *
 * 键 → 路径映射:`<root>/<key 的各段>`,一律经 `path.join` 拼接。
 * ⚠ 校验(`validateWorkspaceKey`)是安全边界,`join` 是**纵深防御**:即便未来键规则被改宽,
 * 也不会因字符串连接把 `a` + `/` + `/etc/passwd` 之类拼成绝对路径。
 *
 * ⚠ **已知平台风险(未做处理,亦不宣称可用)**:
 *  - Windows 设备名(`CON`/`NUL`/`AUX`/`COM1`…)与 NTFS 备用数据流语法(`a:b`)当前被键
 *    校验**刻意放行**——它们在 POSIX 上只是普通文件名。落到 Windows 文件系统时会命中 OS
 *    特殊语义(设备名不可作文件名;`a:b` 写入的是 `a` 的数据流)。本实现**未在 Windows 上
 *    验证过**,不作任何 Windows 可用性承诺;若将来需要支持,应在**键校验层**加平台规则,
 *    而不是在本文件做路径级特判(否则两端实现会各自为政)。
 *  - 大小写:契约规定键**大小写敏感**,而 macOS/Windows 默认文件系统大小写不敏感,
 *    `a.json` 与 `A.json` 在这些平台上会互为别名。同样未做规避,记录在此。
 *
 * pi-SDK-free:只用 node 内置模块与本模块内的纯函数。
 */
import { randomBytes } from "node:crypto";
import { promises as fs, type Dirent, type Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { HOST_CONTRACT_VERSION } from "../host-contract-version.js";
import { validateWorkspaceKey } from "./key.js";
import {
  DEFAULT_WORKSPACE_MAX_VALUE_BYTES,
  WorkspaceConfigError,
  resolveWorkspaceValueLimit,
} from "./limit-config.js";
import { deepMergeJson } from "./merge.js";
import {
  WorkspaceCorruptError,
  WorkspaceIoError,
  WorkspaceKeyError,
  WorkspaceLimitError,
  type JsonObject,
  type Workspace,
  type WorkspaceKey,
  type WorkspaceNamespace,
  type WorkspaceWriteOptions,
} from "./types.js";

/** 键的段分隔符(与平台无关,见 `./key.js`)。 */
const SEPARATOR = "/";

/** 目录权限:与既有 `config/config-codec.ts` 一致。 */
const DIR_MODE = 0o700;
/** 文件权限:与既有 `config/config-codec.ts` 一致。 */
const FILE_MODE = 0o600;

function errnoOf(err: unknown): string | undefined {
  if (err !== null && typeof err === "object" && "code" in err) {
    const code = (err as NodeJS.ErrnoException).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * 键 → 真实路径。先校验(Req 1.1:在触及任何存储**之前**),再按段 `path.join`。
 *
 * 导出供直接单测:映射是安全相关的,值得被独立断言,而不是只经读写路径间接覆盖。
 */
export function resolveWorkspaceKeyPath(root: string, key: WorkspaceKey): string {
  validateWorkspaceKey(key);
  return join(root, ...key.split(SEPARATOR));
}

/**
 * 解析文本为 JSON 对象;非法内容或非对象一律 {@link WorkspaceCorruptError}(Req 2.2)。
 *
 * ⚠ 不得静默返回 `{}`——那会让一次损坏被视作「空配置」,随后被下一次写入整体覆盖。
 * (既有 `config/config-codec.ts` 的 `load` 正是静默吞掉的形态;契约在此**刻意收紧**。)
 */
function parseJsonObject(key: WorkspaceKey, text: string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new WorkspaceCorruptError(key, err);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new WorkspaceCorruptError(key);
  }
  return parsed as JsonObject;
}

/**
 * `stat` 的「不存在即 undefined」变体。
 *
 * `ENOENT`(路径缺失)与 `ENOTDIR`(某个父段是文件,故该路径不可能存在)同等处置——
 * 与 `readJson`/`exists`/`list` 对「不存在」的既有口径一致。
 */
async function statOrUndefined(
  key: WorkspaceKey,
  path: string,
): Promise<Stats | undefined> {
  try {
    return await fs.stat(path);
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw new WorkspaceIoError(key, err);
  }
}

/**
 * 在 `dir`(键 `prefix` 对应的分组目录)之下深度优先找出**第一个值键**,用于让
 * 「不可同址」的错误能说出到底与哪个既有键冲突(Req 1.7)。
 *
 * 目录序不确定,故每层排序后再下探,使同一份数据上的报错稳定可复现。
 * 找不到返回 `undefined`——**该位置一个值键都没有,故根本不构成冲突**(契约 §3.5
 * 「空分组不是冲突」),而不是「冲突的是分组本身」。
 */
async function findValueKeyUnder(
  dir: string,
  prefix: WorkspaceKey,
): Promise<WorkspaceKey | undefined> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const sorted = [...entries].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  );
  for (const entry of sorted) {
    const childKey = `${prefix}${SEPARATOR}${entry.name}`;
    if (entry.isFile()) return childKey;
  }
  for (const entry of sorted) {
    if (!entry.isDirectory()) continue;
    const found = await findValueKeyUnder(
      join(dir, entry.name),
      `${prefix}${SEPARATOR}${entry.name}`,
    );
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * 探测「值与分组不可同址」的冲突(Req 1.7,契约 §3.2 第 6 条),返回冲突说明或 `undefined`。
 *
 * 两个方向都要查,判据一律是**是否存在一个既有值键**:
 *  - 正向:`k` 的任一严格前缀已是值键(已有 `g/a.json`,写 `g/a.json/x.json`);
 *  - 反向:`k` 本身是某既有值键的严格前缀(已有 `g/a.json/x.json`,写 `g/a.json`)。
 *
 * ⚠ **空目录不是冲突**(契约 §3.5)。`delete` 只删值不删父目录,故层级载体上会残留空
 * 目录;它一个值键都不含,而扁平 KV 后端上分组随最后一个值一起消失,同一序列写入成功。
 * 若这里因「路径上是个目录」就拒绝,就制造了一个新的两端分歧——正是勘误⑧ 要消灭的东西。
 * 残留空目录由 {@link prepareWritePath} 清理,不由本函数判成错误。
 *
 * ⚠ 反过来,冲突必须**主动**判成键非法,而不是依赖层级载体碰巧报 `ENOTDIR`/`EISDIR`:
 * 扁平 KV 后端上两者能并存,靠 IO 错误表达会让两端的错误分类对不齐。
 */
async function findCollocationConflict(
  root: string,
  key: WorkspaceKey,
  path: string,
): Promise<string | undefined> {
  const segments = key.split(SEPARATOR);

  // 正向:逐段检查严格前缀。O(段数) 次 stat,只在写路径付出。
  let cursor = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    cursor = join(cursor, segments[i] as string);
    const stat = await statOrUndefined(key, cursor);
    if (stat === undefined) break; // 前缀不存在 ⇒ 更深的前缀与本键路径也不存在
    if (stat.isFile()) {
      const conflict = segments.slice(0, i + 1).join(SEPARATOR);
      return `与既有值键 ${JSON.stringify(conflict)} 冲突:值与分组不可同址(该键的严格前缀已是一个值)`;
    }
  }

  // 反向:键自身在载体上是分组,且其下**确实还存在值键**。
  const own = await statOrUndefined(key, path);
  if (own !== undefined && own.isDirectory()) {
    const conflict = await findValueKeyUnder(path, key);
    if (conflict !== undefined) {
      return `与既有值键 ${JSON.stringify(conflict)} 冲突:值与分组不可同址(该键是它的严格前缀)`;
    }
  }
  return undefined;
}

/**
 * 自底向上删除**全空**的目录树。
 *
 * 刻意用非递归的 `rmdir` 而非 `fs.rm({recursive:true})`:若在探测与清理之间有并发写入
 * 落下了一个值文件,`rmdir` 会以 `ENOTEMPTY` 失败,而 `rm -r` 会把那个值**静默删掉**。
 * 宁可让这次写入报错,也不能吃掉别人的数据。
 *
 * 抛出的是**原始 errno 错误**,由调用方按上下文分类。
 */
async function removeEmptyDirTree(path: string): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(path, { withFileTypes: true });
  } catch (err) {
    const code = errnoOf(err);
    if (code === "ENOENT" || code === "ENOTDIR") return; // 已不在,无事可做
    throw err;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) await removeEmptyDirTree(join(path, entry.name));
  }
  await fs.rmdir(path);
}

/**
 * 写入前的路径准备:拒绝真冲突,清理残留空目录(Req 1.7,契约 §3.2 第 6 条 + §3.5)。
 *
 * 在**任何落盘动作之前**完成,使被拒的写入不留下半个中间目录。
 */
async function prepareWritePath(
  root: string,
  key: WorkspaceKey,
  path: string,
): Promise<void> {
  const conflict = await findCollocationConflict(root, key, path);
  if (conflict !== undefined) throw new WorkspaceKeyError(key, conflict);

  // 走到这里说明该位置没有任何既有值键;若载体上仍是个(全空的)分组目录,把它让出来,
  // 否则 `rename` 会撞上 EISDIR/ENOTEMPTY —— 而按契约这次写入本就应当成功。
  const own = await statOrUndefined(key, path);
  if (own === undefined || !own.isDirectory()) return;
  try {
    await removeEmptyDirTree(path);
  } catch (err) {
    // 清理期间有并发写入落下了值 ⇒ 现在才成为真冲突;否则是环境类故障。
    const raced = await findCollocationConflict(root, key, path);
    if (raced !== undefined) throw new WorkspaceKeyError(key, raced);
    throw new WorkspaceIoError(key, err);
  }
}

/**
 * 原子写入:同目录临时文件 + `rename`(Req 2.6)。
 *
 * - **同目录**:`rename` 只在同一文件系统内保证原子,跨设备会退化为复制。
 * - 临时名带 pid 与随机后缀,避免并发写同一键时相互覆盖。
 * - 任一步失败都清理临时文件,不留垃圾。
 *   ⚠ 进程被强杀时仍可能留下 `.<name>.<pid>-<rand>.tmp`,它会被 `list` 当成一个键返回、
 *   也能被 `readJson` 读到。刻意**不**在 `list` 里按名字过滤:那会把一个合法的同名键悄悄
 *   隐藏,是更坏的失败模式。此形态已作为本地实现的**已声明限制**写入契约 §3.5(勘误⑨b),
 *   一致性套件不得对其断言。
 * - 目录 0700 / 文件 0600,与既有 `ConfigCodec` 一致;`rename` 保留临时文件的权限位。
 *
 * ⚠ 捕获里遇 `ENOTDIR`/`EISDIR`/`ENOTEMPTY`/`EEXIST` 时**重新探测一次真冲突**再分类:
 * 这是 {@link prepareWritePath} 之后的兜底(校验与写入之间存在竞态窗口)。刻意**不**按
 * errno 直接判成键非法——并发写一个更深的键会 `mkdir -p` 出一个空目录并在此撞上
 * `EISDIR`,而空目录按契约 §3.5 不是冲突,那样会把一次瞬时竞态谎报成键非法。
 */
async function writeFileAtomic(
  root: string,
  key: WorkspaceKey,
  path: string,
  json: string,
): Promise<void> {
  const dir = dirname(path);
  const tmp = join(
    dir,
    `.${basename(path)}.${process.pid.toString(36)}-${randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    await fs.mkdir(dir, { recursive: true, mode: DIR_MODE });
    await fs.writeFile(tmp, json, { encoding: "utf8", mode: FILE_MODE });
    await fs.rename(tmp, path);
  } catch (err) {
    // 失败清理:临时文件可能尚未创建,`force` 使其不存在时也成功。
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    const code = errnoOf(err);
    if (
      code === "ENOTDIR" ||
      code === "EISDIR" ||
      code === "ENOTEMPTY" ||
      code === "EEXIST"
    ) {
      const conflict = await findCollocationConflict(root, key, path);
      if (conflict !== undefined) throw new WorkspaceKeyError(key, conflict);
    }
    throw new WorkspaceIoError(key, err);
  }
}

/** {@link createLocalWorkspaceNamespace} 的可选项。 */
export interface LocalWorkspaceNamespaceOptions {
  /**
   * 单键值上限(字节)。缺省取契约默认值 1 MiB。
   *
   * 任务 4.3 会由装配层经 `resolveWorkspaceValueLimit(process.env)` 传入;此处收参数
   * 而不直读 env,使一致性套件能**不改写进程环境**地指定上限(Req 8.6)。
   */
  readonly maxValueBytes?: number;
}

/**
 * 校验显式传入的上限取值(装配期),口径与 `resolveWorkspaceValueLimit` 对 env 的判据一致。
 *
 * ★ 靶心是 `NaN`:写时校验是 `size > maxValueBytes`,而 `size > NaN` **恒为 `false`**
 * ——上限会**完全静默失效**,任意大的值都能写进去。这正是契约 §3.2.1 对 env 路径明令
 * fail-fast 所要消灭的失败形态;上限有两条入口(env 与构造参数),口径不该分裂。
 * `Infinity` / 0 / 负数 / 小数虽不静默(会让写入全被拒或上限失真),但同属装配期配置错误,
 * 一并在此拦下。
 *
 * ⚠ 复用 {@link WorkspaceConfigError}:它是**装配期配置错误**,语义正相符,且刻意不属于
 * 那四个运行期判别码。其首参 `source` 是**配置来源的可读标识**而非 env 变量名,故参数路径
 * 传选项名即可,消息读作 `invalid maxValueBytes option="NaN": ...`。
 */
function assertValidMaxValueBytes(source: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new WorkspaceConfigError(
      source,
      String(value),
      "expected a positive integer number of bytes",
    );
  }
}

/**
 * 装配一个以 `root` 为根的命名空间。
 *
 * 两个根各自调用一次即得双根隔离(任务 4.3 装配);同一 `root` 的两次调用共享磁盘状态。
 *
 * 上限校验落在**本工厂**而非只落在 {@link createLocalWorkspace}:本工厂是上限进入生效路径
 * (那次 `size > maxValueBytes` 比较)的**唯一咽喉**——装配入口经转发同受把守,故此处覆盖面
 * 支配装配层。反之若只在装配层校验,直接调用本工厂的路径就洞开。
 */
export function createLocalWorkspaceNamespace(
  root: string,
  options: LocalWorkspaceNamespaceOptions = {},
): WorkspaceNamespace {
  if (options.maxValueBytes !== undefined) {
    assertValidMaxValueBytes("maxValueBytes option", options.maxValueBytes);
  }
  const maxValueBytes = options.maxValueBytes ?? DEFAULT_WORKSPACE_MAX_VALUE_BYTES;
  const pathOf = (key: WorkspaceKey): string => resolveWorkspaceKeyPath(root, key);

  const readAt = async (key: WorkspaceKey, path: string): Promise<JsonObject> => {
    let text: string;
    try {
      text = await fs.readFile(path, "utf8");
    } catch (err) {
      // 缺失键读为空对象(Req 2.1);其余失败(权限、磁盘故障等)为 IO 错误。
      //
      // ★ `ENOTDIR` 与 `ENOENT` **同等处置**:键的某个前缀段是值文件时(如 `g/a.json` 已存在
      // 而键为 `g/a.json/x.json`),底层给的是 ENOTDIR。语义上「前缀段是值文件 ⇒ 其下的键
      // 不存在」,与 `list`/`exists` 的口径必须**唯一**——否则同一实例会对同一个不存在的键
      // 给出互斥答案(读抛故障、列举与存在性说不存在)。
      //
      // ★ `EISDIR` 同理:键指向的是**分组**。「值与分组不可同址」(Req 1.7)保证分组永不是
      // 值键,故读一个分组前缀就是读一个不存在的键 ⇒ 按 Req 2.1/1.8 返回 `{}`,**不得**抛
      // IO 错误(否则扁平 KV 后端上同一个键返回 `{}`、层级后端上抛错,两端对不齐)。
      //
      // ⚠ 此处**不校验上限**,任何体积的既有值都必须能读回(Req 3.5、契约 §3.2.1):
      // 若读也设限,把上限调小之后既有超限值将不可达,而用户无法自救(要缩小它必须先读到它)。
      const code = errnoOf(err);
      if (code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR") return {};
      throw new WorkspaceIoError(key, err);
    }
    return parseJsonObject(key, text);
  };

  return {
    async readJson(key) {
      return readAt(key, pathOf(key));
    },

    async writeJson(key, values, opts?: WorkspaceWriteOptions) {
      const path = pathOf(key); // 键校验先行(Req 1.1)
      // 「值与分组不可同址」先于任何落盘动作,使冲突写入不留下半个中间目录(Req 1.7);
      // 同时让出残留的空分组目录(契约 §3.5)。
      await prepareWritePath(root, key, path);

      // merge:false → 整体覆盖,使既有值中本次未提供的字段被删除(Req 2.4);
      // 缺省 → 与既有值深度合并(Req 2.3)。
      const next =
        opts?.merge === false ? values : deepMergeJson(await readAt(key, path), values);

      // 上限只在**写**路径校验(Req 3.4)。
      // 计量口径照契约 §3.2.1(勘误⑨a):**合并后整值**的**紧凑** `JSON.stringify` UTF-8
      // 字节数。量合并后整值而非入参——否则反复用小补丁 merge 能让实际值无限膨胀而每次都
      // 「合规」;用紧凑形态而非落盘的缩进形态——落盘表示可以更大,不算超限,否则同一个值
      // 在扁平 KV 后端写得进、在本实现却写不进。
      const size = Buffer.byteLength(JSON.stringify(next), "utf8");
      if (size > maxValueBytes) throw new WorkspaceLimitError(key, size, maxValueBytes);

      await writeFileAtomic(root, key, path, JSON.stringify(next, null, 2));
    },

    async list(prefix) {
      const dir = pathOf(prefix);
      let entries: Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (err) {
        // 前缀不存在(或本身就是个值文件)→ 无匹配,返回空数组。
        const code = errnoOf(err);
        if (code === "ENOENT" || code === "ENOTDIR") return [];
        throw new WorkspaceIoError(prefix, err);
      }
      const keys: WorkspaceKey[] = [];
      for (const entry of entries) {
        // 只收**持有值**的直接子级:子目录是分组,不返回也不展开(Req 2.7)。
        if (entry.isFile()) keys.push(`${prefix}${SEPARATOR}${entry.name}`);
      }
      // 码元序升序:显式比较器,不用区域相关的 localeCompare,保证跨实现确定性。
      return keys.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    },

    async delete(key) {
      // ★ 键校验(`pathOf`)必须在 `try` **之外**:它抛的是 `WorkspaceKeyError`,而下面的
      // catch 是按 errno 分类 IO 故障的——把校验放进 try,`WorkspaceKeyError` 会命中兜底的
      // `throw new WorkspaceIoError(...)`,一个**非法键**于是被报成 IO 故障(判别码 `io`)。
      // 调用方按 `code` 分流(契约 §3.6),那等于安全边界的拒绝理由被抹掉。
      // 同理见 `exists`。
      const path = pathOf(key);
      try {
        await fs.unlink(path);
      } catch (err) {
        // 不存在即幂等成功(Req 2.8)。
        //
        // 三个 errno 都表示「这个**值键**不存在」,口径与 `readJson`/`exists`/`list` 必须一致:
        //  - `ENOENT`  路径缺失;
        //  - `ENOTDIR` 某个前缀段是值文件,故其下的键不存在;
        //  - `EISDIR`(Linux)/`EPERM`(macOS) 路径是**分组**目录 —— 分组永不是值键
        //    (Req 1.7/1.8),故要删的那个值键同样不存在。删除必须是无副作用的成功,
        //    尤其**不得**顺带递归删掉分组之下的值。
        const code = errnoOf(err);
        if (code === "ENOENT" || code === "ENOTDIR") return;
        if (code === "EISDIR" || code === "EPERM") {
          const stat = await statOrUndefined(key, path);
          if (stat === undefined || stat.isDirectory()) return;
        }
        throw new WorkspaceIoError(key, err);
      }
    },

    async exists(key) {
      // ★ 同 `delete`:键校验必须在 `try` 之外,否则非法键被报成 IO 故障。
      const path = pathOf(key);
      try {
        const stat = await fs.stat(path);
        // 目录是分组而非值:持有值才算存在(Req 2.9,与 list 的口径一致)。
        return stat.isFile();
      } catch (err) {
        if (errnoOf(err) === "ENOENT" || errnoOf(err) === "ENOTDIR") return false;
        throw new WorkspaceIoError(key, err);
      }
    },
  };
}

/** {@link createLocalWorkspace} 的可选项(任务 4.3)。 */
export interface LocalWorkspaceOptions {
  /** 用户级根目录。缺省按契约 §3.5 解析:`PI_WEB_AGENT_DIR ?? ~/.pi/agent`。 */
  readonly userRoot?: string;
  /** 项目级根目录。缺省按契约 §3.5 解析:`<cwd>/.pi`。 */
  readonly projectRoot?: string;
  /**
   * 单键值上限(字节)。缺省取 {@link resolveWorkspaceValueLimit} 对 `env` 的解析结果。
   *
   * ⚠ 覆盖的是**取值**,不是「跳过 env 校验」:见 {@link createLocalWorkspace} 的说明。
   */
  readonly maxValueBytes?: number;
  /** 环境来源。缺省 `process.env`;注入形态使测试无需改写进程环境(Req 8.6 同款纪律)。 */
  readonly env?: NodeJS.ProcessEnv;
  /** 工作目录,用于解析项目根。缺省 `process.cwd()`。 */
  readonly cwd?: string;
}

/** {@link resolveLocalWorkspaceRoots} 的结果。 */
export interface LocalWorkspaceRoots {
  readonly userRoot: string;
  readonly projectRoot: string;
}

/**
 * 解析双根的默认位置(契约 §3.5)。
 *
 * 纯函数、收注入的 `env` 与 `cwd`:根的位置是可观测行为的一部分(迁移后必须与既有
 * `config/config-codec.ts` 落在同一处),值得被独立断言,而不是只经写盘路径间接覆盖。
 */
export function resolveLocalWorkspaceRoots(
  env: NodeJS.ProcessEnv,
  cwd: string,
): LocalWorkspaceRoots {
  const agentDir = env.PI_WEB_AGENT_DIR;
  return {
    userRoot:
      agentDir !== undefined && agentDir.trim().length > 0
        ? agentDir
        : join(homedir(), ".pi", "agent"),
    projectRoot: join(cwd, ".pi"),
  };
}

/**
 * 装配双根本地实现(任务 4.3;Req 3.1、4.1-4.4)。
 *
 * **两个根不可合并**(契约 §3.3):`user` 与 `project` 各自装配一个独立命名空间,
 * 各持各的根路径,故同键在两根下映射为两个不同文件——隔离来自根本身,不靠任何
 * 键前缀约定(前缀方案会让键空间被装配层偷偷占用一段,且两端无法对齐)。
 *
 * **上限的三段式 env 契约**(Req 3.1-3.3)在此接通:
 *  - 未设 → 契约默认 1 MiB;
 *  - 设了但非法 → **在本函数返回之前**抛 `WorkspaceConfigError`。装配期失败是刻意的:
 *    留到第一次 `writeJson` 才抛,故障就会以「某次写入莫名失败」的形态出现在离根因很远
 *    的地方,而这正是三段式契约要消灭的形态。
 *  - `maxValueBytes` 覆盖其**取值**;但 env 解析**照常先执行**——即便调用方显式给了上限,
 *    一个写错的 env 也必须炸出来,否则运维改错配置将永无信号(静默忽略与静默回落默认
 *    是同一种病)。故此处刻意**不**写成 `options.maxValueBytes ?? resolve(...)` 的惰性形态。
 */
export function createLocalWorkspace(options: LocalWorkspaceOptions = {}): Workspace {
  const env = options.env ?? process.env;
  const envLimit = resolveWorkspaceValueLimit(env);
  const maxValueBytes = options.maxValueBytes ?? envLimit;

  const defaults = resolveLocalWorkspaceRoots(env, options.cwd ?? process.cwd());
  const userRoot = options.userRoot ?? defaults.userRoot;
  const projectRoot = options.projectRoot ?? defaults.projectRoot;

  return {
    contractVersion: HOST_CONTRACT_VERSION,
    user: createLocalWorkspaceNamespace(userRoot, { maxValueBytes }),
    project: createLocalWorkspaceNamespace(projectRoot, { maxValueBytes }),
  };
}

/**
 * 本地文件系统参照实现(spec: host-contract-ports,任务 4.1;
 * Req 2.1/2.2/2.3/2.4/2.5/2.7/2.8/2.9)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3 与 design.md「LocalWorkspace(参照实现)」。
 *
 * 本文件当前只落地**单个命名空间**的键映射与基本读写:
 *  - 原子写入(同目录 temp + rename)、目录 0700 / 文件 0600、写时上限校验 → 任务 4.2;
 *  - 双根(user / project)装配与上限接线 → 任务 4.3。
 * 故此处刻意只导出 {@link createLocalWorkspaceNamespace},由后续任务在其上扩展,
 * 而不提前造 `createLocalWorkspace` 空壳。
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
import { promises as fs, type Dirent } from "node:fs";
import { dirname, join } from "node:path";
import { validateWorkspaceKey } from "./key.js";
import { deepMergeJson } from "./merge.js";
import {
  WorkspaceCorruptError,
  WorkspaceIoError,
  type JsonObject,
  type WorkspaceKey,
  type WorkspaceNamespace,
  type WorkspaceWriteOptions,
} from "./types.js";

/** 键的段分隔符(与平台无关,见 `./key.js`)。 */
const SEPARATOR = "/";

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
 * 装配一个以 `root` 为根的命名空间。
 *
 * 两个根各自调用一次即得双根隔离(任务 4.3 装配);同一 `root` 的两次调用共享磁盘状态。
 */
export function createLocalWorkspaceNamespace(root: string): WorkspaceNamespace {
  const pathOf = (key: WorkspaceKey): string => resolveWorkspaceKeyPath(root, key);

  const readAt = async (key: WorkspaceKey, path: string): Promise<JsonObject> => {
    let text: string;
    try {
      text = await fs.readFile(path, "utf8");
    } catch (err) {
      // 缺失键读为空对象(Req 2.1);其余失败(权限、EISDIR 等)为 IO 错误。
      //
      // ★ `ENOTDIR` 与 `ENOENT` **同等处置**:键的某个前缀段是值文件时(如 `g/a.json` 已存在
      // 而键为 `g/a.json/x.json`),底层给的是 ENOTDIR。语义上「前缀段是值文件 ⇒ 其下的键
      // 不存在」,与 `list`/`exists` 的口径必须**唯一**——否则同一实例会对同一个不存在的键
      // 给出互斥答案(读抛故障、列举与存在性说不存在)。
      const code = errnoOf(err);
      if (code === "ENOENT" || code === "ENOTDIR") return {};
      throw new WorkspaceIoError(key, err);
    }
    return parseJsonObject(key, text);
  };

  return {
    async readJson(key) {
      return readAt(key, pathOf(key));
    },

    async writeJson(key, values, opts?: WorkspaceWriteOptions) {
      const path = pathOf(key);
      // merge:false → 整体覆盖,使既有值中本次未提供的字段被删除(Req 2.4);
      // 缺省 → 与既有值深度合并(Req 2.3)。
      const next =
        opts?.merge === false ? values : deepMergeJson(await readAt(key, path), values);
      const json = JSON.stringify(next, null, 2);
      try {
        await fs.mkdir(dirname(path), { recursive: true });
        await fs.writeFile(path, json, "utf8");
      } catch (err) {
        throw new WorkspaceIoError(key, err);
      }
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
      try {
        await fs.unlink(pathOf(key));
      } catch (err) {
        // 不存在即幂等成功(Req 2.8)。
        if (errnoOf(err) === "ENOENT") return;
        throw new WorkspaceIoError(key, err);
      }
    },

    async exists(key) {
      try {
        const stat = await fs.stat(pathOf(key));
        // 目录是分组而非值:持有值才算存在(Req 2.9,与 list 的口径一致)。
        return stat.isFile();
      } catch (err) {
        if (errnoOf(err) === "ENOENT" || errnoOf(err) === "ENOTDIR") return false;
        throw new WorkspaceIoError(key, err);
      }
    },
  };
}

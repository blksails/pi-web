/**
 * 内存 Workspace 夹具(spec: host-contract-ports,任务 3.1)。
 *
 * ⚠ **测试夹具,非参照实现。** 刻意落在 `test/` 镜像目录而非 `src/workspace/testing/`,
 * 因为后者会随 `./testing` 子路径成为对外公开面 —— 本 spec 只认 `LocalWorkspace`
 * 一个参照实现。本夹具的唯一用途是在 `LocalWorkspace`(任务 4.x)存在**之前**自证套件
 * 有效(合规版应全绿、违规版应被抓出)。
 *
 * 提供两个变体:
 *  - {@link createMemoryWorkspace}   合规:校验键、按契约语义读写。
 *  - {@link createLaxMemoryWorkspace} 违规:**故意不校验键**,用于证明套件真的会失败。
 */
import { HOST_CONTRACT_VERSION } from "../../../src/host-contract-version.js";
import { validateWorkspaceKey } from "../../../src/workspace/key.js";
import { deepMergeJson } from "../../../src/workspace/merge.js";
import { DEFAULT_WORKSPACE_MAX_VALUE_BYTES } from "../../../src/workspace/limit-config.js";
import {
  WorkspaceCorruptError,
  WorkspaceLimitError,
  type JsonObject,
  type Workspace,
  type WorkspaceKey,
  type WorkspaceNamespace,
  type WorkspaceWriteOptions,
} from "../../../src/workspace/types.js";

export interface MemoryWorkspaceOptions {
  readonly maxValueBytes?: number;
  /** 故意跳过键校验(违规变体用)。 */
  readonly skipKeyValidation?: boolean;
  /**
   * 故意**逐字段撕裂写入**并在字段之间让出事件循环(违规变体用)。
   *
   * 用途:证明并发原子可见性用例不是恒真断言 —— 合规实现整值替换故该用例必过,
   * 若不另造一个会撕裂的实现,那条断言在任何被测实现上都通不过失败,等于没验。
   */
  readonly tornWrites?: boolean;
  /**
   * 故意**在读路径也校验上限**(违规变体用)。
   *
   * 用途:证明「上限调小后既有超限值仍可读」不是恒真断言 —— 合规实现读路径不设限故
   * 该用例必过,若不另造一个读也校验的实现,那条断言永远失败不了,等于没验。
   */
  readonly enforceLimitOnRead?: boolean;
}

/** 以序列化字节数计量,与契约的上限口径一致。 */
function sizeOf(values: JsonObject): number {
  return Buffer.byteLength(JSON.stringify(values) ?? "", "utf8");
}

type ResolvedOptions = Required<
  Pick<
    MemoryWorkspaceOptions,
    "maxValueBytes" | "skipKeyValidation" | "tornWrites" | "enforceLimitOnRead"
  >
>;

function createNamespace(
  store: Map<string, string>,
  opts: ResolvedOptions,
): WorkspaceNamespace {
  const check = (key: WorkspaceKey): void => {
    if (!opts.skipKeyValidation) validateWorkspaceKey(key);
  };

  const read = (key: WorkspaceKey): JsonObject => {
    const raw = store.get(key);
    if (raw === undefined) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new WorkspaceCorruptError(key);
      }
      return parsed as JsonObject;
    } catch (err) {
      if (err instanceof WorkspaceCorruptError) throw err;
      throw new WorkspaceCorruptError(key, err);
    }
  };

  return {
    async readJson(key) {
      check(key);
      const value = read(key);
      if (opts.enforceLimitOnRead) {
        // 违规:读路径也校验上限 —— 会使调小上限后的既有数据不可达。
        const size = sizeOf(value);
        if (size > opts.maxValueBytes) {
          throw new WorkspaceLimitError(key, size, opts.maxValueBytes);
        }
      }
      return value;
    },

    async writeJson(key, values, writeOpts?: WorkspaceWriteOptions) {
      check(key);
      const next = writeOpts?.merge === false ? values : deepMergeJson(read(key), values);
      const size = sizeOf(next);
      if (size > opts.maxValueBytes) {
        throw new WorkspaceLimitError(key, size, opts.maxValueBytes);
      }
      if (opts.tornWrites) {
        // 违规变体:逐字段落盘并在字段之间 await,使并发读者能观察到"半个值"。
        let partial: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(next)) {
          partial = { ...partial, [k]: v };
          store.set(key, JSON.stringify(partial));
          await Promise.resolve(); // 让出事件循环 —— 制造可被观察的中间态
        }
        return;
      }
      // 合规:单值一次性替换 —— Map.set 本身即原子,读者不会看到中间态。
      store.set(key, JSON.stringify(next));
    },

    async list(prefix) {
      check(prefix);
      const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
      const out: WorkspaceKey[] = [];
      for (const key of store.keys()) {
        if (!key.startsWith(base)) continue;
        const rest = key.slice(base.length);
        // 只返回**直接子级**的值键:更深层结构不返回也不展开。
        if (rest.length > 0 && !rest.includes("/")) out.push(key);
      }
      return out.sort();
    },

    async delete(key) {
      check(key);
      store.delete(key); // 不存在也成功 —— 幂等。
    },

    async exists(key) {
      check(key);
      return store.has(key);
    },
  };
}

/** 夹具产出:workspace + 套件所需的 `corrupt` / `reopen` 钩子。 */
export interface MemoryWorkspaceHandle {
  readonly workspace: Workspace;
  /** 把某键的既有值改写为非法 JSON(端口之下的破坏,无法经 API 构造)。 */
  corrupt(namespace: "user" | "project", key: string): Promise<void>;
  /** 以新选项重开**同一份数据**(复用同一组 Map),用于跨配置场景。 */
  reopen(opts?: { maxValueBytes?: number }): Promise<Workspace>;
}

type Stores = { user: Map<string, string>; project: Map<string, string> };

function assemble(stores: Stores, resolved: ResolvedOptions): Workspace {
  return {
    contractVersion: HOST_CONTRACT_VERSION,
    user: createNamespace(stores.user, resolved),
    project: createNamespace(stores.project, resolved),
  };
}

function build(opts: MemoryWorkspaceOptions): MemoryWorkspaceHandle {
  const resolve = (o: MemoryWorkspaceOptions): ResolvedOptions => ({
    maxValueBytes: o.maxValueBytes ?? DEFAULT_WORKSPACE_MAX_VALUE_BYTES,
    skipKeyValidation: o.skipKeyValidation ?? false,
    tornWrites: o.tornWrites ?? false,
    enforceLimitOnRead: o.enforceLimitOnRead ?? false,
  });
  // 两个根各自独立的 Map —— 双根隔离在此结构上天然成立。
  const stores: Stores = {
    user: new Map<string, string>(),
    project: new Map<string, string>(),
  };
  return {
    workspace: assemble(stores, resolve(opts)),
    async corrupt(namespace, key) {
      stores[namespace].set(key, "{ this is not json");
    },
    async reopen(next) {
      // ★ 复用同一组 Map —— 这正是「同一份数据、不同配置」的载体。
      return assemble(stores, resolve({ ...opts, ...next }));
    },
  };
}

/** 合规内存实现:应通过套件全部用例。 */
export function createMemoryWorkspace(
  opts: MemoryWorkspaceOptions = {},
): MemoryWorkspaceHandle {
  return build(opts);
}

/** 违规内存实现:**故意不校验键**,应被套件的键空间用例组抓出。 */
export function createLaxMemoryWorkspace(
  opts: MemoryWorkspaceOptions = {},
): MemoryWorkspaceHandle {
  return build({ ...opts, skipKeyValidation: true });
}

/** 违规内存实现:**故意撕裂写入**,应被套件的并发原子可见性用例抓出。 */
export function createTornMemoryWorkspace(
  opts: MemoryWorkspaceOptions = {},
): MemoryWorkspaceHandle {
  return build({ ...opts, tornWrites: true });
}

/** 违规内存实现:**读路径也校验上限**,应被套件的上限第 ③ 例抓出。 */
export function createReadLimitedMemoryWorkspace(
  opts: MemoryWorkspaceOptions = {},
): MemoryWorkspaceHandle {
  return build({ ...opts, enforceLimitOnRead: true });
}

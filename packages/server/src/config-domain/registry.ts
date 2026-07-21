/**
 * 配置域注册表的内存实现(spec: host-contract-ports,任务 5.3;Req 7.1/7.2/7.5)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §6。
 */
import { validateWorkspaceKey } from "../workspace/key.js";
import { ConfigDomainRegistrationError } from "./types.js";
import type { ConfigDomainDescriptor, ConfigDomainRegistry } from "./types.js";

/** 键的段分隔符;域 id 是**单段**,故它一出现即非法(契约 §6 语义 5)。 */
const SEPARATOR = "/";

/**
 * 是否是键空间校验抛出的「键非法」错误。
 *
 * 按**稳定判别码** `code === "key"` 判,不用 `instanceof`:跨包/跨仓时同名类可能来自不同
 * 模块实例,`instanceof` 会假阴性——测试看起来通过,实际什么都没验到(契约勘误①,与
 * `WorkspaceError` 的判别约定一致)。
 */
function isWorkspaceKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { readonly code?: unknown }).code === "key"
  );
}

/**
 * 校验域 id:先过键空间规则(复用 `validateWorkspaceKey`,不另立一套),再加「单段」这层。
 *
 * 两层缺一不可:键空间规则拦下空串、`..`、反斜杠、NUL、绝对路径等,但 `sources/settings`
 * 这类**多段**键在它眼里完全合法——而域 id 落盘为 `<id>.json`,多段会写到子目录去。
 */
function assertDomainId(id: string): void {
  try {
    validateWorkspaceKey(id);
  } catch (cause) {
    // ⚠ **按错误是什么分类,不按错误在哪发生分类。** 无区分捕获会把校验器自身的实现缺陷
    // (如将来新增分支抛 TypeError)一律贴上 `invalid-id`,即把**实现故障伪装成调用方的
    // 输入错误**——与任务 4.2 判定为缺陷的「按 errno 盲目分类」是同一种病。故只转译确属
    // 键非法的错误,其余原样上抛,不包装。
    if (!isWorkspaceKeyError(cause)) throw cause;
    throw new ConfigDomainRegistrationError(
      "invalid-id",
      typeof id === "string" ? id : String(id),
      cause instanceof Error ? cause.message : "invalid id",
      { cause },
    );
  }
  if (id.includes(SEPARATOR)) {
    throw new ConfigDomainRegistrationError(
      "invalid-id",
      id,
      `id must be a single segment (no ${JSON.stringify(SEPARATOR)})`,
    );
  }
}

/**
 * 建一个空注册表。
 *
 * 底层用 `Map`:其迭代顺序即插入顺序。**不可**改用普通对象——对象会把整数形态的键
 * (如 `"10"`)提前并按数值排序,`list()` 的顺序保证随即失效。
 */
export function createConfigDomainRegistry(): ConfigDomainRegistry {
  const domains = new Map<string, ConfigDomainDescriptor>();

  return {
    register(descriptor: ConfigDomainDescriptor): void {
      const { id } = descriptor;
      // 校验一律在写入之前:失败的注册不得留下任何痕迹。
      assertDomainId(id);
      if (domains.has(id)) {
        throw new ConfigDomainRegistrationError("duplicate", id, "id is already registered");
      }
      domains.set(id, descriptor);
    },

    get(id: string): ConfigDomainDescriptor | undefined {
      return domains.get(id);
    },

    list(): readonly ConfigDomainDescriptor[] {
      return [...domains.values()];
    },
  };
}

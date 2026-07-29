/**
 * attachment-store · 描述符注册表 `AttachmentRegistry`(L1,task 2.3)。
 *
 * 持久化与查询**不含字节**的 `Attachment` 描述符(字节归 `LocalFsBlobBackend`;字节与元数据分离)。
 * 按 id 保存/读取、按会话列出(`listBySession`,后续由门面 `AttachmentStore` 提升为一等只读访问器)。
 *
 * 设计约束(design.md §AttachmentRegistry、Physical Data Model;Req 2.1/2.2/2.5/2.7):
 * - **盘上布局**(与 `LocalFsBlobBackend` 落盘布局一致、不冲突):
 *     <root>/<id>.att.json   Attachment 描述符 JSON(旁路;字节文件 <root>/<id>、meta <root>/<id>.meta.json 归后端)
 *   描述符旁路后缀 `.att.json` 与后端字节(`<id>`)/meta(`<id>.meta.json`)三者互不冲突,可共存于同一 root。
 * - **单一身份**(Req 2.5):描述符以 `id` 为文件名键,同一 id 仅一份旁路文件;重复 `save` 覆盖同一文件,
 *   不产生第二条 → `save` 对同一 id 幂等。
 * - 描述符**不含字节**(Req 2.2):`Attachment` 类型本身排除字节,持久化即原样 JSON。
 * - `listBySession` 扫描 root 下所有 `.att.json` 旁路,过滤 `sessionId === 给定会话`(Req 2.7);
 * - 持久化语义:`save` 后(含进程重启 = 对同一 root 新建实例)`get`/`listBySession` 可读回完整描述符。
 *
 * root 目录(`PI_WEB_ATTACHMENT_DIR`)经构造注入,与后端共享同一 root;完整 config 解析归 task 2.5。
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Attachment } from "@blksails/pi-web-protocol";

/** 描述符旁路文件后缀(`<root>/<id>.att.json`)。 */
const DESCRIPTOR_SUFFIX = ".att.json";

/**
 * 描述符注册表端口(`attachment-backend-pluggable` spec 引入):把既有 `AttachmentRegistry`
 * 类的公开形状提为接口,使描述符存取经配置可插拔(本地/S3 等实现均满足此端口)。
 *
 * 接口风格与既有可插拔存储(session-store-adapters)对齐:异步 `动词+名词`(Req 1.8)。
 */
export interface AttachmentRegistryPort {
  save(att: Attachment): Promise<void>;
  get(id: string): Promise<Attachment | undefined>;
  listBySession(sessionId: string): Promise<Attachment[]>;
  /**
   * 读回某附件的不透明扩展 meta(attachment-tool-bridge 增量,领域无关;门面 `getMeta` 直接委托)。
   * 描述符不存在或未曾 `setMeta` 过均返回 `undefined`。
   */
  getMeta(id: string): Promise<Record<string, unknown> | undefined>;
  /**
   * 写入某附件的不透明扩展 meta(整体覆盖,不与旧值合并;门面 `setMeta` 直接委托)。
   * 目标描述符不存在时抛 {@link AttachmentDescriptorNotFoundError}(安全拒绝)。
   */
  setMeta(id: string, meta: Record<string, unknown>): Promise<void>;
}

/**
 * `Attachment` 描述符(不含字节)的本地文件系统持久化与查询——{@link AttachmentRegistryPort} 端口
 * 的既有本地实现(更名保留,barrel 留 `AttachmentRegistry` 兼容别名)。
 *
 * @param root 落盘根目录(与 `LocalFsBlobBackend` 共享同一 `PI_WEB_ATTACHMENT_DIR`)。
 */
export class LocalFsAttachmentRegistry implements AttachmentRegistryPort {
  constructor(private readonly root: string) {}

  /** 描述符旁路文件的盘上绝对路径(`<root>/<id>.att.json`)。 */
  private descriptorPath(id: string): string {
    return join(this.root, id + DESCRIPTOR_SUFFIX);
  }

  /**
   * 保存描述符到旁路文件;同一 id 覆盖同一文件 → 不产生第二条(单一身份,Req 2.5)。
   *
   * 以 `id` 为文件名键保证「同一 id 仅一条描述符」:重复 `save` 是幂等覆盖,而非追加。
   */
  async save(att: Attachment): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.descriptorPath(att.id), JSON.stringify(att), "utf8");
  }

  /**
   * 按 id 读回完整描述符(不含字节);不存在返回 `undefined`(Req 2.1)。
   */
  async get(id: string): Promise<Attachment | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.descriptorPath(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
    return JSON.parse(raw) as Attachment;
  }

  /**
   * 按会话属主列出附件描述符:扫描 root 下所有 `.att.json` 旁路,过滤 `sessionId`(Req 2.7)。
   *
   * 仅返回该会话的附件;root 不存在(尚无任何落库)返回空数组。
   */
  async listBySession(sessionId: string): Promise<Attachment[]> {
    let entries: string[];
    try {
      entries = await readdir(this.root);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const out: Attachment[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(DESCRIPTOR_SUFFIX)) continue;
      const raw = await readFile(join(this.root, entry), "utf8");
      const att = JSON.parse(raw) as Attachment;
      if (att.sessionId === sessionId) out.push(att);
    }
    return out;
  }

  /**
   * 读回描述符旁路文件的原始 JSON(未收窄为 {@link Attachment});不存在返回 `undefined`。
   *
   * 供 `getMeta`/`setMeta` 内部复用,以在不打扰 `get`/`listBySession`(严格收窄为 `Attachment`)
   * 的前提下,原样保留/写回旁路文件里 `Attachment` 之外的不透明扩展字段(`ext`)。
   */
  private async readDescriptorRaw(
    id: string,
  ): Promise<Record<string, unknown> | undefined> {
    let raw: string;
    try {
      raw = await readFile(this.descriptorPath(id), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
    return JSON.parse(raw) as Record<string, unknown>;
  }

  /**
   * 读回某附件的不透明扩展 meta(旁路文件的 `ext` 字段,attachment-tool-bridge 增量;领域无关)。
   *
   * attachment 层**不解释** `ext` 的内容(上层如 Canvas hydrate 血缘 `{derivedFrom,genParams}` 等
   * 结构由调用方自行约定),仅原样存取。描述符不存在或未曾 `setMeta` 过(无 `ext` 字段)均返回 `undefined`。
   */
  async getMeta(id: string): Promise<Record<string, unknown> | undefined> {
    const raw = await this.readDescriptorRaw(id);
    if (raw === undefined) return undefined;
    const ext = raw["ext"];
    if (ext === undefined) return undefined;
    return ext as Record<string, unknown>;
  }

  /**
   * 写入某附件的不透明扩展 meta,持久到旁路文件的 `ext` 字段(整体覆盖,不与旧值合并)。
   *
   * 不触碰描述符其余字段(`id`/`name`/`mimeType`/… 原样保留);目标描述符不存在时抛
   * {@link AttachmentDescriptorNotFoundError}(安全拒绝,不静默造出半个描述符)。
   */
  async setMeta(id: string, meta: Record<string, unknown>): Promise<void> {
    const raw = await this.readDescriptorRaw(id);
    if (raw === undefined) {
      throw new AttachmentDescriptorNotFoundError(id);
    }
    const next = { ...raw, ext: meta };
    await mkdir(this.root, { recursive: true });
    await writeFile(this.descriptorPath(id), JSON.stringify(next), "utf8");
  }
}

/**
 * 兼容别名(module-local,非 barrel):存量直接 `import { AttachmentRegistry } from
 * "./attachment-registry.js"` 的调用点在类更名后零改动继续通过类型检查(Req 1.1 完成态)。
 */
export { LocalFsAttachmentRegistry as AttachmentRegistry };

/**
 * `setMeta` 目标描述符不存在时抛出的可识别错误(安全拒绝,而非静默造出半个描述符)。
 */
export class AttachmentDescriptorNotFoundError extends Error {
  constructor(readonly id: string) {
    super(`attachment descriptor not found: ${id}`);
    this.name = "AttachmentDescriptorNotFoundError";
  }
}

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
 * `Attachment` 描述符(不含字节)的持久化与查询。
 *
 * 接口风格与既有可插拔存储(session-store-adapters)对齐:异步 `动词+名词`(Req 1.8)。
 *
 * @param root 落盘根目录(与 `LocalFsBlobBackend` 共享同一 `PI_WEB_ATTACHMENT_DIR`)。
 */
export class AttachmentRegistry {
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
}

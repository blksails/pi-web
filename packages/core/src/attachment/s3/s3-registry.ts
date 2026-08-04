/**
 * attachment · S3 描述符注册表 `S3AttachmentRegistry`(`attachment-backend-pluggable` spec,
 * 任务 4.4;Req 5.2, 5.3)。
 *
 * 实现 {@link AttachmentRegistryPort} 端口,把 `Attachment` 描述符持久化到 S3 兼容对象存储,
 * 使多副本实例共享同一描述符视图(Req 5.3)。
 *
 * 设计约束(design.md §S3 后端):
 * - **布局**:`att/<id>.json`(描述符原样序列化,与本地 `.att.json` 内容同构)+
 *   `by-session/<sessionId>/<id>`(空对象二级索引,供 `listBySession` 前缀枚举);
 * - `save`:先写描述符对象,再写会话索引对象(均幂等覆盖,Req 单一身份/2.5 同构语义);
 * - `listBySession`:按 `by-session/<sessionId>/` 前缀枚举索引 key,并发 `get` 取回描述符;
 * - `get` 未找到 → `undefined`(与本地实现同形,Req 2.1);
 * - `getMeta`/`setMeta`:整体覆盖/原样读回描述符 JSON 的 `ext` 字段(与本地实现同语义)。
 */
import type { Attachment } from "@blksails/pi-web-protocol";
import {
  AttachmentDescriptorNotFoundError,
  type AttachmentRegistryPort,
} from "../attachment-registry.js";
import { S3Client, S3NotFoundError, type S3ClientConfig } from "./s3-client.js";

export interface S3AttachmentRegistryConfig extends S3ClientConfig {
  /** key 前缀(缺省空串);描述符对象落 `<prefix>att/<id>.json`。 */
  readonly prefix?: string;
}

/** S3 兼容对象存储承载描述符的 {@link AttachmentRegistryPort} 实现。 */
export class S3AttachmentRegistry implements AttachmentRegistryPort {
  private readonly client: S3Client;
  private readonly prefix: string;

  constructor(config: S3AttachmentRegistryConfig) {
    this.client = new S3Client(config);
    this.prefix = config.prefix ?? "";
  }

  private descriptorKey(id: string): string {
    return `${this.prefix}att/${id}.json`;
  }

  private indexKey(sessionId: string, id: string): string {
    return `${this.prefix}by-session/${sessionId}/${id}`;
  }

  /** 先写描述符对象,再写会话索引对象(均幂等覆盖,Req 单一身份)。 */
  async save(att: Attachment): Promise<void> {
    const body = new TextEncoder().encode(JSON.stringify(att));
    await this.client.putObject(this.descriptorKey(att.id), body, {
      contentType: "application/json",
    });
    await this.client.putObject(this.indexKey(att.sessionId, att.id), new Uint8Array(0), {
      contentType: "application/octet-stream",
    });
  }

  /** 按 id 读回完整描述符;不存在返回 `undefined`(Req 2.1)。 */
  async get(id: string): Promise<Attachment | undefined> {
    const raw = await this.readDescriptorRaw(id);
    if (raw === undefined) return undefined;
    return raw as unknown as Attachment;
  }

  /** 按会话属主列出描述符:前缀枚举二级索引 + 并发取回描述符(Req 5.2)。 */
  async listBySession(sessionId: string): Promise<Attachment[]> {
    const entries = await this.client.listObjectsV2(`${this.prefix}by-session/${sessionId}/`);
    const ids = entries.map((e) => e.key.slice(`${this.prefix}by-session/${sessionId}/`.length));
    const results = await Promise.all(ids.map((id) => this.get(id)));
    return results.filter((a): a is Attachment => a !== undefined);
  }

  async getMeta(id: string): Promise<Record<string, unknown> | undefined> {
    const raw = await this.readDescriptorRaw(id);
    if (raw === undefined) return undefined;
    const ext = raw["ext"];
    if (ext === undefined) return undefined;
    return ext as Record<string, unknown>;
  }

  async setMeta(id: string, meta: Record<string, unknown>): Promise<void> {
    const raw = await this.readDescriptorRaw(id);
    if (raw === undefined) throw new AttachmentDescriptorNotFoundError(id);
    const next = { ...raw, ext: meta };
    const body = new TextEncoder().encode(JSON.stringify(next));
    await this.client.putObject(this.descriptorKey(id), body, {
      contentType: "application/json",
    });
  }

  private async readDescriptorRaw(id: string): Promise<Record<string, unknown> | undefined> {
    try {
      const { stream } = await this.client.getObject(this.descriptorKey(id));
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch (err) {
      if (err instanceof S3NotFoundError) return undefined;
      throw err;
    }
  }
}

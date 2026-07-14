/**
 * attachment · S3BlobBackend 真实服务集成测试(attachment-backend-pluggable spec,任务 4.3;
 * Req 5.1/5.3/5.4)。
 *
 * env 门控:未配置真实 S3 兼容服务时整体 skip(不得让默认 CI 依赖外部服务)。配置方式:
 *   PI_WEB_TEST_S3_ENDPOINT / PI_WEB_TEST_S3_BUCKET / PI_WEB_TEST_S3_ACCESS_KEY /
 *   PI_WEB_TEST_S3_SECRET_KEY(必需);PI_WEB_TEST_S3_REGION(缺省 us-east-1)/
 *   PI_WEB_TEST_S3_FORCE_PATH_STYLE=1(MinIO 等多数需要 path-style)。
 *
 * 覆盖:put/getReadStream/head/presignUrl(direct fetch 校验可达)/delete 五操作真实互通;
 * 双实例字节互读(Req 5.3 多副本共享同一视图)。
 */
import { describe, expect, it } from "vitest";
import { S3BlobBackend } from "../../../src/attachment/s3/s3-blob-backend.js";

const ENDPOINT = process.env["PI_WEB_TEST_S3_ENDPOINT"];
const BUCKET = process.env["PI_WEB_TEST_S3_BUCKET"];
const ACCESS_KEY = process.env["PI_WEB_TEST_S3_ACCESS_KEY"];
const SECRET_KEY = process.env["PI_WEB_TEST_S3_SECRET_KEY"];
const REGION = process.env["PI_WEB_TEST_S3_REGION"] ?? "us-east-1";
const FORCE_PATH_STYLE = process.env["PI_WEB_TEST_S3_FORCE_PATH_STYLE"] === "1";

const configured =
  ENDPOINT !== undefined && BUCKET !== undefined && ACCESS_KEY !== undefined && SECRET_KEY !== undefined;

function makeBackend(prefix: string): S3BlobBackend {
  return new S3BlobBackend({
    endpoint: ENDPOINT!,
    bucket: BUCKET!,
    region: REGION,
    accessKeyId: ACCESS_KEY!,
    secretAccessKey: SECRET_KEY!,
    forcePathStyle: FORCE_PATH_STYLE,
    prefix,
  });
}

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe.skipIf(!configured)("S3BlobBackend 真实服务集成(env 门控,Req 5.1/5.3/5.4)", () => {
  it("put → getReadStream/head/presignUrl/delete 五操作真实互通", async () => {
    const backend = makeBackend(`it-${Date.now()}/`);
    const key = "att_real_1";
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);

    await backend.put(key, bytes, { mimeType: "image/png", size: bytes.length });

    const head = await backend.head(key);
    expect(head).toEqual({ mimeType: "image/png", size: bytes.length });

    const { stream, meta } = await backend.getReadStream(key);
    expect(meta).toEqual({ mimeType: "image/png", size: bytes.length });
    expect([...(await readAll(stream))]).toEqual([...bytes]);

    const url = await backend.presignUrl(key, { expiresInMs: 60_000 });
    const res = await fetch(url);
    expect(res.status).toBe(200);
    const fetched = new Uint8Array(await res.arrayBuffer());
    expect([...fetched]).toEqual([...bytes]);

    await backend.delete(key);
    await expect(backend.head(key)).rejects.toThrow();
  });

  it("双实例字节互读(Req 5.3:多副本实例共享同一附件视图)", async () => {
    const prefix = `it-${Date.now()}-shared/`;
    const writer = makeBackend(prefix);
    const reader = makeBackend(prefix);
    const key = "att_shared";
    const bytes = new Uint8Array([9, 8, 7]);

    await writer.put(key, bytes, { mimeType: "application/octet-stream", size: bytes.length });
    const { stream, meta } = await reader.getReadStream(key);
    expect(meta.size).toBe(bytes.length);
    expect([...(await readAll(stream))]).toEqual([...bytes]);

    await writer.delete(key);
  });
});

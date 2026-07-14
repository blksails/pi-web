/**
 * attachment · S3Client 单测(attachment-backend-pluggable spec,任务 4.2;Req 5.1)。
 *
 * 注入假 `fetch` 断言:五操作(PUT/GET/HEAD/DELETE/ListObjectsV2)请求形状(URL/method/签名 header
 * 存在)与响应映射;404/`NoSuchKey` → {@link S3NotFoundError};其余非 2xx → {@link S3RequestError}
 * (携带 status/code)。
 */
import { describe, expect, it, vi } from "vitest";
import { S3Client, S3NotFoundError, S3RequestError } from "../../../src/attachment/s3/s3-client.js";

const BASE_CONFIG = {
  bucket: "my-bucket",
  region: "us-east-1",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

function jsonHeaders(extra: Record<string, string> = {}): Headers {
  return new Headers({ "content-type": "application/octet-stream", ...extra });
}

describe("S3Client.putObject(Req 5.1)", () => {
  it("PUT 请求携带签名 Authorization header 且路径含 bucket 虚拟托管风格", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await client.putObject("att_abc", new Uint8Array([1, 2, 3]), { contentType: "image/png" });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://my-bucket.s3.amazonaws.com/att_abc");
    expect(calls[0]!.init.method).toBe("PUT");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/);
    expect(headers["content-type"]).toBe("image/png");
  });

  it("路径风格寻址(forcePathStyle)把 bucket 放进路径而非 host", async () => {
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toBe("https://minio.local/my-bucket/att_x");
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
    const client = new S3Client({
      ...BASE_CONFIG,
      endpoint: "https://minio.local",
      forcePathStyle: true,
      fetchImpl,
    });
    await client.putObject("att_x", new Uint8Array([1]), { contentType: "text/plain" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("S3Client.getObject(Req 5.1)", () => {
  it("成功 → 返回可读流 + meta(mimeType/size 经 content-type/content-length 头)", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(new Uint8Array([9, 8, 7]), {
        status: 200,
        headers: jsonHeaders({ "content-length": "3", "content-type": "image/jpeg" }),
      }),
    ) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    const { stream, meta } = await client.getObject("att_y");
    expect(meta.contentType).toBe("image/jpeg");
    expect(meta.contentLength).toBe(3);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    expect([...Buffer.concat(chunks)]).toEqual([9, 8, 7]);
  });

  it("HTTP 404 → 抛 S3NotFoundError", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await expect(client.getObject("missing")).rejects.toBeInstanceOf(S3NotFoundError);
  });

  it("S3 <Code>NoSuchKey</Code> XML(非 404 状态码场景)→ 抛 S3NotFoundError", async () => {
    const xml = "<Error><Code>NoSuchKey</Code><Message>not found</Message></Error>";
    const fetchImpl = vi.fn(async () => new Response(xml, { status: 403 })) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await expect(client.getObject("missing2")).rejects.toBeInstanceOf(S3NotFoundError);
  });

  it("其余非 2xx → 抛 S3RequestError,携带 status 与 code", async () => {
    const xml = "<Error><Code>AccessDenied</Code><Message>denied</Message></Error>";
    const fetchImpl = vi.fn(async () => new Response(xml, { status: 403 })) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await expect(client.getObject("x")).rejects.toMatchObject({
      status: 403,
      code: "AccessDenied",
    });
    await expect(client.getObject("x")).rejects.toBeInstanceOf(S3RequestError);
  });
});

describe("S3Client.headObject(Req 5.1)", () => {
  it("成功 → 返回元信息", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(null, {
        status: 200,
        headers: jsonHeaders({ "content-length": "42", "content-type": "text/plain" }),
      }),
    ) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    const meta = await client.headObject("k");
    expect(meta).toEqual({ contentType: "text/plain", contentLength: 42 });
  });

  it("404 → 抛 S3NotFoundError", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await expect(client.headObject("missing")).rejects.toBeInstanceOf(S3NotFoundError);
  });
});

describe("S3Client.deleteObject(Req 5.1/7.1/7.2 幂等)", () => {
  it("成功删除不抛", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await expect(client.deleteObject("k")).resolves.toBeUndefined();
  });

  it("目标不存在(404)→ 幂等不抛(端口契约)", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 404 })) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await expect(client.deleteObject("missing")).resolves.toBeUndefined();
  });
});

describe("S3Client.listObjectsV2(Req 5.2)", () => {
  it("解析 XML 响应中的 <Key> 列表", async () => {
    const xml = `<?xml version="1.0"?>
<ListBucketResult>
  <Contents><Key>by-session/s1/att_a</Key></Contents>
  <Contents><Key>by-session/s1/att_b</Key></Contents>
</ListBucketResult>`;
    const fetchImpl = vi.fn(async (url: string | URL) => {
      expect(String(url)).toContain("list-type=2");
      expect(String(url)).toContain("prefix=by-session%2Fs1%2F");
      return new Response(xml, { status: 200 });
    }) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    const entries = await client.listObjectsV2("by-session/s1/");
    expect(entries.map((e) => e.key)).toEqual(["by-session/s1/att_a", "by-session/s1/att_b"]);
  });

  it("空结果返回空数组", async () => {
    const xml = `<ListBucketResult></ListBucketResult>`;
    const fetchImpl = vi.fn(async () => new Response(xml, { status: 200 })) as unknown as typeof fetch;
    const client = new S3Client({ ...BASE_CONFIG, fetchImpl });
    await expect(client.listObjectsV2("nope/")).resolves.toEqual([]);
  });
});

describe("S3Client.presignGetUrl(Req 5.4)", () => {
  it("产出携带 X-Amz-Signature 的可直达 URL(虚拟托管风格)", () => {
    const client = new S3Client(BASE_CONFIG);
    const url = client.presignGetUrl("att_p", 3600);
    expect(url).toMatch(/^https:\/\/my-bucket\.s3\.amazonaws\.com\/att_p\?/);
    const params = new URL(url).searchParams;
    expect(params.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(params.get("X-Amz-Expires")).toBe("3600");
  });
});

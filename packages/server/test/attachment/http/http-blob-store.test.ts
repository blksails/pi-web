/**
 * attachment · HttpBlobStore 单测(`sandbox-attachment-store` spec Wave A'1)。
 *
 * 起一个真实 `node:http` fake server 断言:put/getReadStream/head/presignUrl/delete 命中的
 * 路由、方法、请求头(name/mime/token);4xx/5xx/连接失败 → RemoteAttachmentError;404 →
 * BlobNotFoundError;token 不落任何 console 输出。
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlobNotFoundError } from "../../../src/attachment/blob-store.js";
import { HttpBlobStore } from "../../../src/attachment/http/http-blob-store.js";
import { RemoteAttachmentError } from "../../../src/attachment/http/remote-attachment-error.js";

const TOKEN = "s3cr3t-token-should-never-leak";

interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: Buffer;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function startServer(
  handler: (req: RecordedRequest, res: import("node:http").ServerResponse) => void | Promise<void>,
): Promise<{ server: Server; endpoint: string; requests: RecordedRequest[] }> {
  const requests: RecordedRequest[] = [];
  const server = createServer((req, res) => {
    void (async () => {
      const body = await readBody(req);
      const rec: RecordedRequest = { method: req.method!, url: req.url!, headers: req.headers, body };
      requests.push(rec);
      await handler(rec, res);
    })();
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, endpoint: `http://127.0.0.1:${port}/internal/attachments/blob`, requests });
    });
  });
}

let consoleSpies: ReturnType<typeof vi.spyOn>[];
let consoleOutput: string[];

beforeEach(() => {
  consoleOutput = [];
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(" "));
    }),
  );
});

afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
  expect(consoleOutput.join("\n")).not.toContain(TOKEN);
});

describe("HttpBlobStore.put", () => {
  it("PUT {endpoint}/{key} 携带 name/mime/token 头,二进制 body,返回 PutReceipt", async () => {
    const { server, endpoint, requests } = await startServer((rec, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ backendName: "cloud-http-1" }));
    });
    try {
      const store = new HttpBlobStore({ endpoint, token: TOKEN });
      const receipt = await store.put("att_1", new Uint8Array([1, 2, 3]), { mimeType: "image/png", size: 3 });
      expect(receipt).toEqual({ backendName: "cloud-http-1" });
      expect(requests).toHaveLength(1);
      const req = requests[0]!;
      expect(req.method).toBe("PUT");
      expect(req.url).toBe("/internal/attachments/blob/att_1");
      expect(req.headers["x-pi-attachment-name"]).toBe("att_1");
      expect(req.headers["x-pi-attachment-mime"]).toBe("image/png");
      expect(req.headers["x-pi-attachment-token"]).toBe(TOKEN);
      expect([...req.body]).toEqual([1, 2, 3]);
    } finally {
      server.close();
    }
  });

  it("非 2xx → RemoteAttachmentError(携带 status)", async () => {
    const { server, endpoint } = await startServer((_rec, res) => {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("boom");
    });
    try {
      const store = new HttpBlobStore({ endpoint, token: TOKEN });
      await expect(
        store.put("att_1", new Uint8Array([1]), { mimeType: "text/plain", size: 1 }),
      ).rejects.toBeInstanceOf(RemoteAttachmentError);
    } finally {
      server.close();
    }
  });

  it("连接失败(端口未监听)→ RemoteAttachmentError", async () => {
    const store = new HttpBlobStore({ endpoint: "http://127.0.0.1:1/internal/attachments/blob", token: TOKEN });
    await expect(
      store.put("att_1", new Uint8Array([1]), { mimeType: "text/plain", size: 1 }),
    ).rejects.toBeInstanceOf(RemoteAttachmentError);
  });
});

describe("HttpBlobStore.getReadStream", () => {
  it("GET {endpoint}/{key}/raw → 流 + meta(经响应头)", async () => {
    const { server, endpoint, requests } = await startServer((_rec, res) => {
      res.writeHead(200, { "content-type": "image/webp", "content-length": "2" });
      res.end(Buffer.from([5, 6]));
    });
    try {
      const store = new HttpBlobStore({ endpoint, token: TOKEN });
      const { stream, meta } = await store.getReadStream("k1");
      expect(meta).toEqual({ mimeType: "image/webp", size: 2 });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect([...Buffer.concat(chunks)]).toEqual([5, 6]);
      expect(requests[0]!.url).toBe("/internal/attachments/blob/k1/raw");
      expect(requests[0]!.headers["x-pi-attachment-token"]).toBe(TOKEN);
    } finally {
      server.close();
    }
  });

  it("404 → BlobNotFoundError", async () => {
    const { server, endpoint } = await startServer((_rec, res) => {
      res.writeHead(404);
      res.end();
    });
    try {
      const store = new HttpBlobStore({ endpoint, token: TOKEN });
      await expect(store.getReadStream("missing")).rejects.toBeInstanceOf(BlobNotFoundError);
    } finally {
      server.close();
    }
  });
});

describe("HttpBlobStore.head", () => {
  it("GET {endpoint}/{key}/head → JSON meta;404 → BlobNotFoundError", async () => {
    const { server, endpoint } = await startServer((rec, res) => {
      if (rec.url.endsWith("/missing/head")) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ mimeType: "text/plain", size: 9 }));
    });
    try {
      const store = new HttpBlobStore({ endpoint, token: TOKEN });
      await expect(store.head("k2")).resolves.toEqual({ mimeType: "text/plain", size: 9 });
      await expect(store.head("missing")).rejects.toBeInstanceOf(BlobNotFoundError);
    } finally {
      server.close();
    }
  });
});

describe("HttpBlobStore.presignUrl", () => {
  it("GET {endpoint}/{key}/presign → JSON {url}", async () => {
    const { server, endpoint, requests } = await startServer((_rec, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ url: "https://oss.example/att_1?sig=abc" }));
    });
    try {
      const store = new HttpBlobStore({ endpoint, token: TOKEN });
      const url = await store.presignUrl("k3", { expiresInMs: 60_000 });
      expect(url).toBe("https://oss.example/att_1?sig=abc");
      expect(requests[0]!.url).toBe("/internal/attachments/blob/k3/presign?expiresInMs=60000");
    } finally {
      server.close();
    }
  });
});

describe("HttpBlobStore.delete", () => {
  it("DELETE {endpoint}/{key} 幂等(404 不抛)", async () => {
    const { server, endpoint } = await startServer((_rec, res) => {
      res.writeHead(404);
      res.end();
    });
    try {
      const store = new HttpBlobStore({ endpoint, token: TOKEN });
      await expect(store.delete("missing")).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });
});

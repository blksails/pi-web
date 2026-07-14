/**
 * attachment · HttpAttachmentRegistry 单测(`sandbox-attachment-store` spec Wave A'2)。
 *
 * 起一个真实 `node:http` fake server 断言:save/get/listBySession/getMeta/setMeta 命中的路由、
 * 方法、token 头,往返正确;404 语义按端口分层(get/getMeta → undefined,setMeta →
 * AttachmentDescriptorNotFoundError);token 不落任何 console 输出。
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "@blksails/pi-web-protocol";
import { AttachmentDescriptorNotFoundError } from "../../../src/attachment/attachment-registry.js";
import { HttpAttachmentRegistry } from "../../../src/attachment/http/http-attachment-registry.js";
import { RemoteAttachmentError } from "../../../src/attachment/http/remote-attachment-error.js";

const TOKEN = "s3cr3t-token-should-never-leak";

const ATT: Attachment = {
  id: "att_1",
  name: "a.png",
  mimeType: "image/png",
  size: 3,
  origin: "tool-output",
  sessionId: "sess_1",
  createdAt: new Date().toISOString(),
};

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
      resolve({ server, endpoint: `http://127.0.0.1:${port}/internal/attachments/descriptor`, requests });
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

describe("HttpAttachmentRegistry.save", () => {
  it("POST {endpoint}/descriptor 携带 token 头,body=JSON Attachment", async () => {
    const { server, endpoint, requests } = await startServer((_rec, res) => {
      res.writeHead(200);
      res.end();
    });
    try {
      const registry = new HttpAttachmentRegistry({ endpoint, token: TOKEN });
      await registry.save(ATT);
      expect(requests[0]!.method).toBe("POST");
      expect(requests[0]!.url).toBe("/internal/attachments/descriptor/descriptor");
      expect(requests[0]!.headers["x-pi-attachment-token"]).toBe(TOKEN);
      expect(JSON.parse(requests[0]!.body.toString("utf8"))).toEqual(ATT);
    } finally {
      server.close();
    }
  });

  it("非 2xx → RemoteAttachmentError", async () => {
    const { server, endpoint } = await startServer((_rec, res) => {
      res.writeHead(500);
      res.end("boom");
    });
    try {
      const registry = new HttpAttachmentRegistry({ endpoint, token: TOKEN });
      await expect(registry.save(ATT)).rejects.toBeInstanceOf(RemoteAttachmentError);
    } finally {
      server.close();
    }
  });
});

describe("HttpAttachmentRegistry.get", () => {
  it("GET {endpoint}/{id} → Attachment;404 → undefined", async () => {
    const { server, endpoint } = await startServer((rec, res) => {
      if (rec.url.endsWith("/missing")) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(ATT));
    });
    try {
      const registry = new HttpAttachmentRegistry({ endpoint, token: TOKEN });
      await expect(registry.get("att_1")).resolves.toEqual(ATT);
      await expect(registry.get("missing")).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });
});

describe("HttpAttachmentRegistry.listBySession", () => {
  it("GET {endpoint}?sessionId= → Attachment[]", async () => {
    const { server, endpoint, requests } = await startServer((_rec, res) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify([ATT]));
    });
    try {
      const registry = new HttpAttachmentRegistry({ endpoint, token: TOKEN });
      await expect(registry.listBySession("sess_1")).resolves.toEqual([ATT]);
      expect(requests[0]!.url).toBe("/internal/attachments/descriptor?sessionId=sess_1");
    } finally {
      server.close();
    }
  });
});

describe("HttpAttachmentRegistry.getMeta/setMeta", () => {
  it("GET {endpoint}/{id}/meta → ext;404 → undefined", async () => {
    const { server, endpoint } = await startServer((rec, res) => {
      if (rec.url.endsWith("/missing/meta")) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ derivedFrom: "x" }));
    });
    try {
      const registry = new HttpAttachmentRegistry({ endpoint, token: TOKEN });
      await expect(registry.getMeta("att_1")).resolves.toEqual({ derivedFrom: "x" });
      await expect(registry.getMeta("missing")).resolves.toBeUndefined();
    } finally {
      server.close();
    }
  });

  it("PUT {endpoint}/{id}/meta 往返;404(描述符不存在) → AttachmentDescriptorNotFoundError", async () => {
    const { server, endpoint, requests } = await startServer((rec, res) => {
      if (rec.url.endsWith("/missing/meta")) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200);
      res.end();
    });
    try {
      const registry = new HttpAttachmentRegistry({ endpoint, token: TOKEN });
      await registry.setMeta("att_1", { derivedFrom: "y" });
      expect(requests[0]!.method).toBe("PUT");
      expect(JSON.parse(requests[0]!.body.toString("utf8"))).toEqual({ derivedFrom: "y" });
      await expect(registry.setMeta("missing", { x: 1 })).rejects.toBeInstanceOf(
        AttachmentDescriptorNotFoundError,
      );
    } finally {
      server.close();
    }
  });
});

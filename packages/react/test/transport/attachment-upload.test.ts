import { describe, it, expect, vi } from "vitest";
import { uploadAttachment } from "../../src/transport/attachment-upload.js";
import type { UploadAttachmentResponse } from "@pi-web/protocol";

function makeFile(name = "pic.png", type = "image/png"): File {
  return new File([new Uint8Array([1, 2, 3, 4])], name, { type });
}

function validResponse(): UploadAttachmentResponse {
  return {
    attachment: {
      id: "att_abc123",
      name: "pic.png",
      mimeType: "image/png",
      size: 4,
      origin: "upload",
      sessionId: "s1",
      createdAt: "2026-06-21T00:00:00.000Z",
    },
    displayUrl: "/attachments/att_abc123/raw?exp=123&sig=deadbeef",
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
function mockFetch(impl: FetchFn) {
  return vi.fn<FetchFn>(impl);
}

describe("uploadAttachment", () => {
  it("POSTs multipart to /sessions/:id/attachments and parses the descriptor", async () => {
    const body = validResponse();
    const fetchImpl = mockFetch(async () => jsonResponse(body));

    const result = await uploadAttachment(
      "http://host/api",
      "s1",
      makeFile(),
      fetchImpl,
    );

    expect(result.attachment.id).toBe("att_abc123");
    expect(result.displayUrl).toBe(body.displayUrl);

    // exactly one call, to the session upload endpoint
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://host/api/sessions/s1/attachments");
    expect(init?.method).toBe("POST");
    // multipart body carries the file under `file`
    expect(init?.body).toBeInstanceOf(FormData);
    const fd = init?.body as FormData;
    const sent = fd.get("file");
    expect(sent).toBeInstanceOf(File);
    expect((sent as File).name).toBe("pic.png");
  });

  it("url-encodes the session id in the endpoint path", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(validResponse()));
    await uploadAttachment("http://host/api", "a/b c", makeFile(), fetchImpl);
    const [url] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://host/api/sessions/a%2Fb%20c/attachments");
  });

  it("does not set a content-type header (lets fetch derive the multipart boundary)", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(validResponse()));
    await uploadAttachment("http://host/api", "s1", makeFile(), fetchImpl);
    const [, init] = fetchImpl.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.has("content-type")).toBe(false);
  });

  it("throws on a non-2xx response so the caller hook can catch it", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ code: "NO_FILE", message: "no file part" }, 400));
    await expect(
      uploadAttachment("http://host/api", "s1", makeFile(), fetchImpl),
    ).rejects.toThrow();
  });

  it("throws when the response body does not match the schema", async () => {
    // missing `displayUrl`, and attachment.size is negative
    const fetchImpl = mockFetch(async () => jsonResponse({ attachment: { id: "att_x", size: -1 } }));
    await expect(
      uploadAttachment("http://host/api", "s1", makeFile(), fetchImpl),
    ).rejects.toThrow();
  });

  it("uses the global fetch when no fetch is injected", async () => {
    const body = validResponse();
    const spy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(body));
    try {
      const result = await uploadAttachment("http://host/api", "s1", makeFile());
      expect(result.displayUrl).toBe(body.displayUrl);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

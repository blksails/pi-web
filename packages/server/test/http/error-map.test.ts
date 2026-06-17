/**
 * error-map 单测:引擎错误→HTTP 状态码 + 不泄敏感(Req 3.4,3.5,9.1,9.2,9.3,10.1)。
 */
import { describe, expect, it } from "vitest";
import {
  MissingInputError,
  SessionNotFoundError,
  SessionStoppedError,
  UnknownExtensionUIError,
} from "../../src/session/index.js";
import { mapEngineError, type ErrorBody } from "../../src/http/error-map.js";
import { protocolVersion } from "@pi-web/protocol";

describe("mapEngineError", () => {
  it("SessionStoppedError → 409", async () => {
    const res = mapEngineError(new SessionStoppedError("s1"));
    expect(res.status).toBe(409);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("SESSION_STOPPED");
    expect(body.protocolVersion).toBe(protocolVersion);
  });

  it("SessionNotFoundError → 404", () => {
    expect(mapEngineError(new SessionNotFoundError("s1")).status).toBe(404);
  });

  it("UnknownExtensionUIError → 409", () => {
    expect(mapEngineError(new UnknownExtensionUIError("ui-1")).status).toBe(409);
  });

  it("MissingInputError → 400", () => {
    expect(mapEngineError(new MissingInputError("source")).status).toBe(400);
  });

  it("unknown error → 500 without leaking details", async () => {
    const res = mapEngineError(
      new Error("secret API_KEY=abcdef in stack trace"),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.message).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain("API_KEY");
  });

  it("carries protocolVersion header", () => {
    const res = mapEngineError(new SessionStoppedError("s1"));
    expect(res.headers.get("X-Pi-Protocol-Version")).toBe(protocolVersion);
  });
});

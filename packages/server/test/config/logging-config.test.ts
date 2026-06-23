/**
 * logging 配置域集成测试（任务 3.1，Req 6.1 / 6.3）。
 *
 * 覆盖：
 *  - GET /config/logging 返回 formSchema + values
 *  - PUT /config/logging 存值、GET 取回、未知字段保留（Req 6.3）
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createConfigRoutes } from "../../src/config/config-routes.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(
    tmpdir(),
    `logging-cfg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  return text.length > 0 ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function makeHandler(): (req: Request) => Promise<Response> {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createConfigRoutes({ rootDir: tmpDir });
  return createPiWebHandler({ manager, store, routes });
}

describe("GET /config/logging", () => {
  it("returns formSchema with domain=logging", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://x/config/logging"));
    expect(res.status).toBe(200);

    const body = await readJson(res);
    const formSchema = body["formSchema"] as Record<string, unknown>;
    expect(formSchema["domain"]).toBe("logging");
  });

  it("returns empty values when no config file exists", async () => {
    const handler = makeHandler();
    const res = await handler(new Request("http://x/config/logging"));
    expect(res.status).toBe(200);

    const body = await readJson(res);
    expect(body["values"]).toEqual({});
  });
});

describe("PUT /config/logging round-trip (Req 6.3)", () => {
  it("persists values and returns them on GET", async () => {
    const handler = makeHandler();

    const putRes = await handler(
      new Request("http://x/config/logging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          values: { enabled: false, level: "warn" },
        }),
      }),
    );
    expect(putRes.status).toBe(200);

    const getRes = await handler(new Request("http://x/config/logging"));
    expect(getRes.status).toBe(200);
    const body = await readJson(getRes);
    const values = body["values"] as Record<string, unknown>;
    expect(values["enabled"]).toBe(false);
    expect(values["level"]).toBe("warn");
  });

  it("preserves unknown fields on subsequent PUT (passthrough — Req 6.3)", async () => {
    const handler = makeHandler();

    // Pre-seed file with an unknown field.
    await fs.writeFile(
      join(tmpDir, "logging.json"),
      JSON.stringify({ enabled: true, level: "info", _custom: "keep-me" }),
    );

    // PUT only a subset.
    const putRes = await handler(
      new Request("http://x/config/logging", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ values: { enabled: false, level: "warn" } }),
      }),
    );
    expect(putRes.status).toBe(200);

    // Read the raw file to verify unknown field survives.
    const raw = JSON.parse(
      await fs.readFile(join(tmpDir, "logging.json"), "utf-8"),
    ) as Record<string, unknown>;
    // _custom must survive (passthrough + mergeSecrets keeps unknown keys).
    // Note: the schema uses .passthrough() so unknown fields are preserved through zod validation.
    // The mergeSecrets / codec path keeps disk fields that aren't overwritten.
    expect(raw["enabled"]).toBe(false);
    expect(raw["level"]).toBe("warn");
    // The unknown field written before the PUT must survive the round-trip (Req 6.3).
    expect(raw["_custom"]).toBe("keep-me");
  });
});

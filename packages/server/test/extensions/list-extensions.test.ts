/**
 * 单元:GET /extensions(Req 1.1–1.5/7.4/10.1)。
 */
import { describe, expect, it } from "vitest";
import { makeListExtensionsHandler } from "../../src/extensions/routes/list-extensions.js";
import { PiListError } from "../../src/extensions/cli/pi-cli.js";
import { FakePiCli, readJson } from "./helpers.js";
import type { RequestContext } from "../../src/http/index.js";

function ctx(): RequestContext {
  return {
    req: new Request("http://x/extensions"),
    auth: { anonymous: true },
    url: new URL("http://x/extensions"),
  };
}

describe("GET /extensions", () => {
  it("returns a list with scope and source type", async () => {
    const cli = new FakePiCli({
      installed: [
        { id: "@pi-web/a", kind: "npm", version: "1.0.0", scope: "global" },
        { id: "acme/ext", kind: "git", version: "v1", scope: "project" },
      ],
    });
    const res = await makeListExtensionsHandler(cli)(ctx());
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const exts = body["extensions"] as Array<Record<string, unknown>>;
    expect(exts).toHaveLength(2);
    expect(exts[0]).toMatchObject({ id: "@pi-web/a", kind: "npm", scope: "global" });
    expect(exts[1]).toMatchObject({ scope: "project" });
  });

  it("returns an empty list (not an error) when nothing installed", async () => {
    const res = await makeListExtensionsHandler(new FakePiCli())(ctx());
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body["extensions"]).toEqual([]);
  });

  it("returns an identifiable error when pi list fails (no env leak)", async () => {
    const cli = new FakePiCli();
    cli.setListError(new PiListError("pi exited with code 1"));
    const res = await makeListExtensionsHandler(cli)(ctx());
    expect(res.status).toBe(502);
    const body = await readJson(res);
    const err = body["error"] as Record<string, unknown>;
    expect(err["code"]).toBe("EXT_LIST_FAILED");
    expect(JSON.stringify(body)).not.toMatch(/secret|token|API_KEY/i);
  });
});

import { describe, expect, it, vi } from "vitest";
import { Buffer } from "node:buffer";
import { loadExtension, type LoaderDeps } from "../../src/web-ext/extension-loader.js";
import { computeSri } from "../../src/web-ext/extension-gate.js";
import type { WebExtensionManifest } from "@blksails/protocol";

const opts = { whitelist: [], requireSignature: false, hostApiVersion: "0.1.0" };
const bytes = Buffer.from("export default {manifestId:'acme'}", "utf8");

function deps(over: Partial<LoaderDeps> = {}): LoaderDeps {
  return {
    fetchBytes: vi.fn(async () => bytes),
    importModule: vi.fn(async () => ({ default: { manifestId: "acme" } })),
    ...over,
  };
}

describe("loadExtension", () => {
  it("纯声明:零 bundle,从 manifest.config 合成描述符,不 fetch/import", async () => {
    const d = deps();
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      config: { theme: { "--pw-acme-accent": "#09f" }, layout: "split" },
    };
    const r = await loadExtension({ manifest, baseUrl: "/x/", opts, deps: d });
    expect(r.status).toBe("declarative");
    if (r.status === "declarative") expect(r.extension.config?.layout).toBe("split");
    expect(d.fetchBytes).not.toHaveBeenCalled();
    expect(d.importModule).not.toHaveBeenCalled();
  });

  it("代码扩展:SRI+版本通过 → loaded,返回默认导出描述符", async () => {
    const integrity = await computeSri(bytes);
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      integrity,
    };
    const r = await loadExtension({ manifest, baseUrl: "/ext/acme/", opts, deps: deps() });
    expect(r.status).toBe("loaded");
    if (r.status === "loaded") expect(r.extension.manifestId).toBe("acme");
  });

  it("SRI 不符 → rejected,且不动态 import", async () => {
    const d = deps();
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      integrity: "sha384-WRONG",
    };
    const r = await loadExtension({ manifest, baseUrl: "/ext/acme/", opts, deps: d });
    expect(r.status).toBe("rejected");
    expect(d.importModule).not.toHaveBeenCalled();
  });

  it("import 抛错 → rejected(回退),不抛出", async () => {
    const integrity = await computeSri(bytes);
    const d = deps({
      importModule: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      integrity,
    };
    const r = await loadExtension({ manifest, baseUrl: "/ext/acme/", opts, deps: d });
    expect(r.status).toBe("rejected");
  });

  it("默认导出非对象 → rejected", async () => {
    const integrity = await computeSri(bytes);
    const d = deps({
      importModule: vi.fn(async () => ({ default: "nope" as unknown as never })),
    });
    const manifest: WebExtensionManifest = {
      id: "acme",
      targetApiVersion: "^0.1.0",
      entry: "web-extension.mjs",
      integrity,
    };
    const r = await loadExtension({ manifest, baseUrl: "/ext/acme/", opts, deps: d });
    expect(r.status).toBe("rejected");
  });

  it("版本不兼容 → rejected(声明式也拦)", async () => {
    const r = await loadExtension({
      manifest: { id: "acme", targetApiVersion: "^9.0.0" },
      baseUrl: "/x/",
      opts,
      deps: deps(),
    });
    expect(r.status).toBe("rejected");
  });
});

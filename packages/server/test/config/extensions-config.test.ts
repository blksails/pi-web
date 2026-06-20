/**
 * 扩展配置域:settings.json 互映纯函数 + 全局/项目路由(Req 6/7)。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import {
  createExtensionsConfigRoutes,
  settingsToForm,
  applyFormToSettings,
} from "../../src/config/extensions-config-routes.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `ext-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function readJson(res: Response): Promise<Record<string, unknown>> {
  const t = await res.text();
  return t.length > 0 ? (JSON.parse(t) as Record<string, unknown>) : {};
}
function makeHandler() {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  return createPiWebHandler({
    manager,
    store,
    routes: createExtensionsConfigRoutes({ agentDir: tmpDir, defaultCwd: tmpDir }),
    authResolver: () => ({ anonymous: true }),
  });
}

describe("互映纯函数", () => {
  it("settingsToForm:每扩展带 enabled/spec/params;disabled 来自 disabledPackages;排除保留键", () => {
    const settings = {
      lastChangelogVersion: "0.79.6",
      packages: ["npm:pi-sandbox"],
      disabledPackages: ["npm:pi-web-access"],
      defaultProvider: "openrouter",
      theme: "dark",
      commands: { deny: ["dangerous"] },
      "@alexgorbatchev/pi-env": { HTTP_PROXY: "http://localhost:1080" },
    };
    const form = settingsToForm(settings);
    expect(form.commands).toEqual({ deny: ["dangerous"] });
    // 启用 package:带 spec + 空 params。
    expect(form.extensions?.["pi-sandbox"]).toEqual({
      enabled: true,
      spec: "npm:pi-sandbox",
      params: {},
    });
    // 禁用 package(来自 disabledPackages):enabled=false。
    expect(form.extensions?.["pi-web-access"]).toEqual({
      enabled: false,
      spec: "npm:pi-web-access",
      params: {},
    });
    // 手动 KV 块:无 spec、恒启用。
    expect(form.extensions?.["@alexgorbatchev/pi-env"]).toEqual({
      enabled: true,
      params: { HTTP_PROXY: "http://localhost:1080" },
    });
    // 保留键不进 extensions。
    expect(Object.keys(form.extensions ?? {})).not.toContain("packages");
    expect(Object.keys(form.extensions ?? {})).not.toContain("disabledPackages");
    expect(Object.keys(form.extensions ?? {})).not.toContain("theme");
  });

  it("applyFormToSettings:据 enabled 重建 packages/disabledPackages;KV 非空替换、空删除", () => {
    const settings = {
      packages: ["npm:pi-sandbox", "npm:pi-web-access"],
      defaultProvider: "openrouter",
      "@alexgorbatchev/pi-env": { HTTP_PROXY: "old", EXTRA: "keep" },
    };
    const merged = applyFormToSettings(settings, {
      commands: { allow: ["help"] },
      extensions: {
        // 保持启用 + 改 KV。
        "pi-sandbox": { enabled: true, spec: "npm:pi-sandbox", params: { LOG: "1" } },
        // 禁用 → 移入 disabledPackages。
        "pi-web-access": { enabled: false, spec: "npm:pi-web-access", params: {} },
        // 手动 KV(无 spec)→ 不进 packages,KV 整体替换。
        "@alexgorbatchev/pi-env": { enabled: true, params: { HTTP_PROXY: "new" } },
      },
    });
    expect(merged["packages"]).toEqual(["npm:pi-sandbox"]); // 仅启用项
    expect(merged["disabledPackages"]).toEqual(["npm:pi-web-access"]); // 禁用项
    expect(merged["defaultProvider"]).toBe("openrouter"); // 保留
    expect(merged["commands"]).toEqual({ allow: ["help"] }); // 写入
    expect(merged["pi-sandbox"]).toEqual({ LOG: "1" }); // KV 写入
    expect(merged["@alexgorbatchev/pi-env"]).toEqual({ HTTP_PROXY: "new" }); // 整体替换
  });

  it("applyFormToSettings:全部启用时移除 disabledPackages 键(保持干净)", () => {
    const merged = applyFormToSettings(
      { packages: ["npm:a"], disabledPackages: ["npm:b"] },
      {
        extensions: {
          a: { enabled: true, spec: "npm:a", params: {} },
          b: { enabled: true, spec: "npm:b", params: {} },
        },
      },
    );
    expect(merged["packages"]).toEqual(["npm:a", "npm:b"]);
    expect("disabledPackages" in merged).toBe(false);
  });

  it("loadSystemResources:缺省视作 true,显式 false 关闭;不混入 extensions 分组", () => {
    // 缺省 → 表单 true(默认载入系统资源)。
    expect(settingsToForm({}).loadSystemResources).toBe(true);
    // 顶层 false → 表单 false。
    expect(settingsToForm({ loadSystemResources: false }).loadSystemResources).toBe(false);
    // 保留键:不作为 per-扩展 KV 分组出现。
    expect(
      Object.keys(settingsToForm({ loadSystemResources: false }).extensions ?? {}),
    ).not.toContain("loadSystemResources");
  });

  it("applyFormToSettings:仅 false 落键,true 删除该键(保持默认干净)", () => {
    // false → 写入 loadSystemResources:false。
    const off = applyFormToSettings({}, { loadSystemResources: false });
    expect(off["loadSystemResources"]).toBe(false);
    // true → 删除既有键(回到默认载入)。
    const on = applyFormToSettings({ loadSystemResources: false }, { loadSystemResources: true });
    expect("loadSystemResources" in on).toBe(false);
    // 未出现 → 不动既有键。
    const keep = applyFormToSettings({ loadSystemResources: false }, {});
    expect(keep["loadSystemResources"]).toBe(false);
  });
});

describe("全局 /config/extensions/global", () => {
  it("PUT 合并写入 settings.json,保留既有键;GET 读回", async () => {
    await fs.writeFile(
      join(tmpDir, "settings.json"),
      JSON.stringify({ packages: ["npm:pi-sandbox"], theme: "dark" }),
    );
    const handler = makeHandler();
    const put = await handler(
      new Request("http://x/config/extensions/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          values: {
            commands: { deny: ["x"] },
            // 权威全量:保留启用的 pi-sandbox(带 spec)+ 一个手动 KV 条目。
            extensions: {
              "pi-sandbox": { enabled: true, spec: "npm:pi-sandbox", params: {} },
              "@a/b": { enabled: true, params: { K: "v" } },
            },
          },
        }),
      }),
    );
    expect(put.status).toBe(200);
    const onDisk = JSON.parse(await fs.readFile(join(tmpDir, "settings.json"), "utf8"));
    expect(onDisk.packages).toEqual(["npm:pi-sandbox"]); // 启用项重建
    expect(onDisk.theme).toBe("dark"); // 保留
    expect(onDisk.commands).toEqual({ deny: ["x"] });
    expect(onDisk["@a/b"]).toEqual({ K: "v" });

    const get = await handler(new Request("http://x/config/extensions/global"));
    const body = await readJson(get);
    const values = body["values"] as Record<string, unknown>;
    const exts = values["extensions"] as Record<string, unknown>;
    expect(exts["@a/b"]).toEqual({ enabled: true, params: { K: "v" } });
    expect(exts["pi-sandbox"]).toEqual({ enabled: true, spec: "npm:pi-sandbox", params: {} });
    expect(values["commands"]).toEqual({ deny: ["x"] });
  });

  it("PUT 非法值(KV 值非字符串)→ 422", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/extensions/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { extensions: { "@a/b": { params: { K: 123 } } } } }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe("独立配置文件(扫描 + 写回)", () => {
  it("GET 扫描 <dir>/*.json(排除 settings/auth/sandbox/trust),PUT 写回", async () => {
    await fs.writeFile(join(tmpDir, "settings.json"), JSON.stringify({ packages: [] }));
    await fs.writeFile(join(tmpDir, "auth.json"), JSON.stringify({ secret: "x" })); // 应被排除
    await fs.writeFile(join(tmpDir, "sandbox.json"), JSON.stringify({ enabled: true })); // 应被排除
    await fs.writeFile(
      join(tmpDir, "proxy.json"),
      JSON.stringify({ $schema: "https://github.com/aizigao/pi-proxy-fetch/schema.json", enabled: true, profileName: "p" }),
    );
    const handler = makeHandler();
    const get = await handler(new Request("http://x/config/extensions/global"));
    const values = (await readJson(get))["values"] as Record<string, unknown>;
    const files = values["files"] as Record<string, unknown>;
    expect(Object.keys(files)).toEqual(["proxy.json"]); // 仅非保留文件
    expect((files["proxy.json"] as Record<string, unknown>)["profileName"]).toBe("p");

    // PUT 改 proxy.json 内容 → 写回。
    const put = await handler(
      new Request("http://x/config/extensions/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { files: { "proxy.json": { enabled: false, profileName: "q" } } } }),
      }),
    );
    expect(put.status).toBe(200);
    const onDisk = JSON.parse(await fs.readFile(join(tmpDir, "proxy.json"), "utf8"));
    expect(onDisk.profileName).toBe("q");
    expect(onDisk.enabled).toBe(false);
  });

  it("PUT 拒绝写保留/穿越文件名", async () => {
    const handler = makeHandler();
    await handler(
      new Request("http://x/config/extensions/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { files: { "settings.json": { hacked: true }, "../evil.json": { x: 1 } } } }),
      }),
    );
    // settings.json 不被 files 覆盖(仍是 applyFormToSettings 的结果,无 hacked)
    const settings = JSON.parse(await fs.readFile(join(tmpDir, "settings.json"), "utf8"));
    expect(settings.hacked).toBeUndefined();
  });
});

describe("项目 /config/extensions/project", () => {
  it("PUT 写 <cwd>/.pi/settings.json,GET 读回", async () => {
    const handler = makeHandler();
    const put = await handler(
      new Request("http://x/config/extensions/project", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { commands: { allow: ["help"] } } }),
      }),
    );
    expect(put.status).toBe(200);
    const onDisk = JSON.parse(await fs.readFile(join(tmpDir, ".pi", "settings.json"), "utf8"));
    expect(onDisk.commands).toEqual({ allow: ["help"] });

    const get = await handler(new Request("http://x/config/extensions/project"));
    const body = await readJson(get);
    expect((body["values"] as Record<string, unknown>)["commands"]).toEqual({ allow: ["help"] });
  });

  it("cwd 越界 → 403", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/extensions/project?cwd=%2Fetc"),
    );
    expect(res.status).toBe(403);
  });
});

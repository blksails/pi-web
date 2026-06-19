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
  it("settingsToForm:提取 commands + 顶层 per-扩展 KV,排除保留键", () => {
    const settings = {
      lastChangelogVersion: "0.79.6",
      packages: ["npm:pi-sandbox"],
      defaultProvider: "openrouter",
      theme: "dark",
      commands: { deny: ["dangerous"] },
      "@alexgorbatchev/pi-env": { HTTP_PROXY: "http://localhost:1080" },
    };
    const form = settingsToForm(settings);
    expect(form.commands).toEqual({ deny: ["dangerous"] });
    // 已有 KV 块 + 已安装扩展(pi-sandbox)作为空 KV 分组占位。
    expect(form.extensions?.["@alexgorbatchev/pi-env"]).toEqual({ HTTP_PROXY: "http://localhost:1080" });
    expect(form.extensions?.["pi-sandbox"]).toEqual({});
    // 保留键不进 extensions
    expect(Object.keys(form.extensions ?? {})).not.toContain("packages");
    expect(Object.keys(form.extensions ?? {})).not.toContain("theme");
  });

  it("applyFormToSettings:保留既有键,非空整体替换,空 KV 删除", () => {
    const settings = {
      packages: ["npm:pi-sandbox"],
      defaultProvider: "openrouter",
      "@alexgorbatchev/pi-env": { HTTP_PROXY: "old", EXTRA: "keep" },
      "@other/ext": { A: "1" },
      "@empty/ext": { OLD: "x" },
    };
    const merged = applyFormToSettings(settings, {
      commands: { allow: ["help"] },
      extensions: {
        "@alexgorbatchev/pi-env": { HTTP_PROXY: "new" },
        "pi-sandbox": {}, // 已列出但未配置 → 不写空块
        "@empty/ext": {}, // 清空 → 删除既有块
      },
    });
    expect(merged["packages"]).toEqual(["npm:pi-sandbox"]); // 保留
    expect(merged["defaultProvider"]).toBe("openrouter"); // 保留
    expect(merged["commands"]).toEqual({ allow: ["help"] }); // 写入
    expect(merged["@alexgorbatchev/pi-env"]).toEqual({ HTTP_PROXY: "new" }); // 整体替换
    expect(merged["@other/ext"]).toEqual({ A: "1" }); // 未出现 → 不动
    expect("pi-sandbox" in merged).toBe(false); // 空 → 不写
    expect("@empty/ext" in merged).toBe(false); // 空 → 删除
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
          values: { commands: { deny: ["x"] }, extensions: { "@a/b": { K: "v" } } },
        }),
      }),
    );
    expect(put.status).toBe(200);
    const onDisk = JSON.parse(await fs.readFile(join(tmpDir, "settings.json"), "utf8"));
    expect(onDisk.packages).toEqual(["npm:pi-sandbox"]); // 保留
    expect(onDisk.theme).toBe("dark"); // 保留
    expect(onDisk.commands).toEqual({ deny: ["x"] });
    expect(onDisk["@a/b"]).toEqual({ K: "v" });

    const get = await handler(new Request("http://x/config/extensions/global"));
    const body = await readJson(get);
    const values = body["values"] as Record<string, unknown>;
    const exts = values["extensions"] as Record<string, unknown>;
    expect(exts["@a/b"]).toEqual({ K: "v" });
    expect(exts["pi-sandbox"]).toEqual({}); // 已安装扩展作为分组占位
    expect(values["commands"]).toEqual({ deny: ["x"] });
  });

  it("PUT 非法值(KV 值非字符串)→ 422", async () => {
    const handler = makeHandler();
    const res = await handler(
      new Request("http://x/config/extensions/global", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: { extensions: { "@a/b": { K: 123 } } } }),
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

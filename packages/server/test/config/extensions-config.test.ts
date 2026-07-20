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

  it("applyFormToSettings:部分提交(表单未覆盖的既有条目)保留原归属——非破坏契约", () => {
    // 背景:f0e8d09 的「extensions 出现即整体重建」曾让只带手动 KV 条目的部分提交
    // 静默清空 packages(config-domains e2e 假红根因)。修复后:未被表单覆盖的既有
    // packages/disabledPackages 条目保留,表单覆盖的条目仍按 enabled 重建。
    const merged = applyFormToSettings(
      { packages: ["npm:pi-sandbox"], disabledPackages: ["npm:pi-off"], theme: "dark" },
      {
        extensions: {
          // 仅一个手动 KV 条目(无 spec)——不该动 packages/disabledPackages 里的其它人。
          "@a/b": { enabled: true, params: { HTTP_PROXY: "http://localhost:1080" } },
        },
      },
    );
    expect(merged["packages"]).toEqual(["npm:pi-sandbox"]); // 保留
    expect(merged["disabledPackages"]).toEqual(["npm:pi-off"]); // 保留
    expect(merged["@a/b"]).toEqual({ HTTP_PROXY: "http://localhost:1080" });
    expect(merged["theme"]).toBe("dark");

    // 表单覆盖到既有条目时仍按表单归属重建(禁用→启用搬移),未覆盖者不动。
    const moved = applyFormToSettings(
      { packages: ["npm:keep"], disabledPackages: ["npm:pi-off"] },
      { extensions: { "pi-off": { enabled: true, spec: "npm:pi-off", params: {} } } },
    );
    expect(moved["packages"]).toEqual(["npm:keep", "npm:pi-off"]);
    expect("disabledPackages" in moved).toBe(false);
  });

  it("applyFormToSettings:旧扁平 KV wire 形状兼容解析(footgun 修复)——语义保留,不再静默删块", () => {
    // 旧形状(f0e8d09 之前):条目即扁平 KV。曾被按「params 空=删块」处理 → 老客户端静默丢数据。
    const merged = applyFormToSettings(
      { packages: ["npm:pi-sandbox"], "@a/b": { OLD: "keep-me-not" } },
      // 类型面上是新形状,运行时经 zod passthrough 可能携带旧扁平条目 —— 用 unknown 铸型模拟。
      { extensions: { "@a/b": { HTTP_PROXY: "http://localhost:1080" } } } as unknown as Parameters<
        typeof applyFormToSettings
      >[1],
    );
    expect(merged["@a/b"]).toEqual({ HTTP_PROXY: "http://localhost:1080" }); // 转译为 params 写入
    expect(merged["packages"]).toEqual(["npm:pi-sandbox"]); // 归属不受影响

    // 旧扁平条目落在**已装扩展**的 id 上:KV 写入,packages 归属不被挤掉(旧契约从不表达归属)。
    const onInstalled = applyFormToSettings(
      { packages: ["npm:pi-sandbox"] },
      { extensions: { "pi-sandbox": { LOG: "1" } } } as unknown as Parameters<
        typeof applyFormToSettings
      >[1],
    );
    expect(onInstalled["pi-sandbox"]).toEqual({ LOG: "1" });
    expect(onInstalled["packages"]).toEqual(["npm:pi-sandbox"]);

    // 空对象 {} 维持「显式删块」语义(新旧契约一致)。
    const del = applyFormToSettings(
      { "@a/b": { OLD: "x" } },
      { extensions: { "@a/b": {} } } as unknown as Parameters<typeof applyFormToSettings>[1],
    );
    expect("@a/b" in del).toBe(false);

    // 无法归类(全非字符串值)→ 跳过不动:不写不删,宁 no-op 不破坏性猜测。
    const garbage = applyFormToSettings(
      { "@a/b": { OLD: "x" } },
      { extensions: { "@a/b": { nested: { deep: 1 } } } } as unknown as Parameters<
        typeof applyFormToSettings
      >[1],
    );
    expect(garbage["@a/b"]).toEqual({ OLD: "x" });
  });

  it("applyFormToSettings:纯 params 条目(无 enabled/spec)不表达归属——同名已装扩展不被挤出 packages", () => {
    // zod schema 里 enabled 可选(wire 可不带),模块 ExtEntry 类型却必填 —— 铸型模拟 wire 形状。
    const merged = applyFormToSettings(
      { packages: ["npm:pi-sandbox"] },
      { extensions: { "pi-sandbox": { params: { LOG: "1" } } } } as unknown as Parameters<
        typeof applyFormToSettings
      >[1],
    );
    expect(merged["pi-sandbox"]).toEqual({ LOG: "1" });
    expect(merged["packages"]).toEqual(["npm:pi-sandbox"]); // 归属保留
    // 对照:显式 enabled:false + spec 才搬移归属。
    const disabled = applyFormToSettings(
      { packages: ["npm:pi-sandbox"] },
      { extensions: { "pi-sandbox": { enabled: false, spec: "npm:pi-sandbox", params: {} } } },
    );
    expect(disabled["packages"]).toEqual([]);
    expect(disabled["disabledPackages"]).toEqual(["npm:pi-sandbox"]);
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

  it("loadSystemSkills/Extensions:缺省 true;各自独立;兼容旧版合一键", () => {
    // 缺省 → 两者皆 true。
    const def = settingsToForm({});
    expect(def.loadSystemSkills).toBe(true);
    expect(def.loadSystemExtensions).toBe(true);
    // 各自独立:仅关 skills。
    const skillsOff = settingsToForm({ loadSystemSkills: false });
    expect(skillsOff.loadSystemSkills).toBe(false);
    expect(skillsOff.loadSystemExtensions).toBe(true);
    // 旧版合一键 false → 两者都视作关闭(迁移兼容)。
    const legacy = settingsToForm({ loadSystemResources: false });
    expect(legacy.loadSystemSkills).toBe(false);
    expect(legacy.loadSystemExtensions).toBe(false);
    // 保留键不混入 extensions 分组。
    expect(
      Object.keys(settingsToForm({ loadSystemSkills: false }).extensions ?? {}),
    ).not.toContain("loadSystemSkills");
  });

  it("applyFormToSettings:逐键 false 落键、true 删键;并清理旧合一键", () => {
    // 仅关 skills → 写 loadSystemSkills:false,不动 extensions。
    const skillsOff = applyFormToSettings({}, { loadSystemSkills: false, loadSystemExtensions: true });
    expect(skillsOff["loadSystemSkills"]).toBe(false);
    expect("loadSystemExtensions" in skillsOff).toBe(false);
    // true → 删除既有键。
    const on = applyFormToSettings({ loadSystemSkills: false }, { loadSystemSkills: true });
    expect("loadSystemSkills" in on).toBe(false);
    // 写任一新键时,清理旧版合一键。
    const migrated = applyFormToSettings({ loadSystemResources: false }, { loadSystemSkills: false });
    expect("loadSystemResources" in migrated).toBe(false);
    expect(migrated["loadSystemSkills"]).toBe(false);
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

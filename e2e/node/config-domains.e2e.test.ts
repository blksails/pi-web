/**
 * Node-e2e — 配置域端到端:经真实 Next 路由单例 + 注入的 config 路由,驱动
 * 沙箱(全局/项目)与扩展(全局/项目)配置的读写往返与校验。
 *
 * 在导入路由单例**之前**设置 PI_WEB_AGENT_DIR(全局 settings/sandbox 落盘)与
 * PI_WEB_DEFAULT_CWD(项目 .pi/ 落盘),使写入落到临时目录,不污染用户级 ~/.pi/agent。
 */
import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-agent-"));
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cfg-proj-"));
process.env.PI_WEB_STUB_AGENT = "1";
process.env.PI_WEB_AGENT_DIR = agentDir;
process.env.PI_WEB_DEFAULT_CWD = projectDir;

const config = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

afterAll(async () => {
  await shutdownHandler();
  fs.rmSync(agentDir, { recursive: true, force: true });
  fs.rmSync(projectDir, { recursive: true, force: true });
});

const base = "http://localhost/api/config";
async function json(res: Response): Promise<Record<string, unknown>> {
  const t = await res.text();
  return t.length > 0 ? (JSON.parse(t) as Record<string, unknown>) : {};
}
function put(url: string, values: unknown): Promise<Response> {
  return config.PUT(
    new Request(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    }),
  );
}

describe("配置域 e2e — 沙箱", () => {
  it("全局 /config/sandbox 写入 <agentDir>/sandbox.json 并读回", async () => {
    const r = await put(`${base}/sandbox`, {
      enabled: true,
      filesystem: { allowRead: ["."], allowWrite: ["."] },
    });
    expect(r.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(agentDir, "sandbox.json"), "utf8"));
    expect(onDisk.filesystem.allowWrite).toEqual(["."]);
    const g = await config.GET(new Request(`${base}/sandbox`));
    const body = await json(g);
    expect((body["formSchema"] as Record<string, unknown>)["domain"]).toBe("sandbox");
  });

  it("项目 /config/sandbox/project 写入 <projectDir>/.pi/sandbox.json", async () => {
    const r = await put(`${base}/sandbox/project`, { filesystem: { allowWrite: [".", "/tmp"] } });
    expect(r.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, ".pi", "sandbox.json"), "utf8"));
    expect(onDisk.filesystem.allowWrite).toEqual([".", "/tmp"]);
  });

  it("非法值 → 422", async () => {
    const r = await put(`${base}/sandbox`, { enabled: "yes" });
    expect(r.status).toBe(422);
  });
});

describe("配置域 e2e — 扩展", () => {
  it("全局 /config/extensions/global 与 settings.json 互映,保留既有键", async () => {
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ packages: ["npm:pi-sandbox"], theme: "dark" }),
    );
    // 条目形状为现行契约 {enabled, spec?, params}(f0e8d09 起);旧扁平 KV 形状会被
    // passthrough 收下但 params 为空 → 按「删除该块」处理(本用例曾用旧形状假红)。
    const r = await put(`${base}/extensions/global`, {
      commands: { deny: ["danger"] },
      extensions: { "@a/b": { enabled: true, params: { HTTP_PROXY: "http://localhost:1080" } } },
    });
    expect(r.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(agentDir, "settings.json"), "utf8"));
    expect(onDisk.packages).toEqual(["npm:pi-sandbox"]); // 保留
    expect(onDisk.commands).toEqual({ deny: ["danger"] });
    expect(onDisk["@a/b"]).toEqual({ HTTP_PROXY: "http://localhost:1080" });

    const g = await config.GET(new Request(`${base}/extensions/global`));
    const values = (await json(g))["values"] as Record<string, unknown>;
    const exts = values["extensions"] as Record<string, unknown>;
    // 表单视图为现行 ExtEntry 形状(f0e8d09 起):手动 KV 条目无 spec 恒启用;
    // 已安装扩展(packages[])带 spec 与 KV 占位。
    expect(exts["@a/b"]).toEqual({ enabled: true, params: { HTTP_PROXY: "http://localhost:1080" } });
    expect(exts["pi-sandbox"]).toEqual({ enabled: true, spec: "npm:pi-sandbox", params: {} });
  });

  it("项目 /config/extensions/project 写入 <projectDir>/.pi/settings.json", async () => {
    const r = await put(`${base}/extensions/project`, { commands: { allow: ["help"] } });
    expect(r.status).toBe(200);
    const onDisk = JSON.parse(fs.readFileSync(path.join(projectDir, ".pi", "settings.json"), "utf8"));
    expect(onDisk.commands).toEqual({ allow: ["help"] });
  });

  it("项目 cwd 越界 → 403", async () => {
    const r = await config.GET(new Request(`${base}/extensions/project?cwd=%2Fetc`));
    expect(r.status).toBe(403);
  });
});

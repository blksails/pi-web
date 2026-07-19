/**
 * Node 级 e2e — GET/PUT /api/config/source/:sourceKey(spec source-settings-and-slots,
 * 任务 2.2 + 补task 2.3,Req 3.5)。
 *
 * 经 `lib/app/api-route` 驱动真实单例 `createPiWebHandler`(与宿主 `server/index.ts` 的
 * `app.all("/api/*")` 走同一条路),证明本任务在 `lib/app/pi-handler.ts` 里做的路由挂载
 * wiring 确实生效 —— 不是「路由压根不存在」的通用 404,而是「挂载了、业务层判定未知
 * source」的 404(经业务错误码 `SOURCE_NOT_FOUND` 区分)。
 *
 * `PI_WEB_DEFAULT_CWD` 指向一个带 `pi-web.json#settings` 清单的 fixture agent 目录
 * (`packages/server/test/runner/fixtures/settings-assembly-source-e2e-agent/`,任务 3.1
 * 装配期注入复用的同一 fixture)——补task 2.3 的生产 `resolveSettings` 把「未显式指定
 * source 时的隐式激活 agent」纳入候选包根目录集合(见 `lib/app/pi-handler.ts` 的
 * `makeSourceSettingsResolver`),故该 fixture 的 sourceKey 应可查得。
 */
import { describe, it, expect, afterAll } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { sourceKey } from "@blksails/pi-web-server";

const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "source-settings-endpoint-"));
process.env.PI_CODING_AGENT_DIR = agentDir;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(
  HERE,
  "../../packages/server/test/runner/fixtures/settings-assembly-source-e2e-agent",
);
process.env.PI_WEB_DEFAULT_CWD = FIXTURE_DIR;
// 补task 2.3 的候选目录还并入「已安装/已登记本地目录源」枚举(扫描根 ∪ 注册表)——测试环境
// 未配置扫描根/注册表时两路均静默产出空列表(既有 fallback 行为),不影响本文件断言。

const api = await import("@/lib/app/api-route");
const { shutdownHandler } = await import("@/lib/app/pi-handler");

afterAll(async () => {
  await shutdownHandler();
  fs.rmSync(agentDir, { recursive: true, force: true });
});

interface ErrorBody {
  error: { code: string; message: string };
}

// 16-hex 形状的合法 sourceKey(与 `sourceKey()` 工具的输出形状一致,任意满足形状即可,
// 本测试不依赖某个真实注册的 source)。
const VALID_SHAPE_SOURCE_KEY = "0123456789abcdef";

describe("GET /api/config/source/:sourceKey(经真实 handler)", () => {
  it("路由已挂载:业务层判定的 404(SOURCE_NOT_FOUND),不是「路径无匹配」的通用 404", async () => {
    const res = await api.GET(
      new Request(`http://localhost/api/config/source/${VALID_SHAPE_SOURCE_KEY}`),
    );
    expect(res.status).toBe(404);

    const body = (await res.json()) as ErrorBody;
    // 业务错误码,证明请求确实进了 source-settings-routes 的 handler(挂载生效),
    // 而非 Router 对完全未注册路径的兜底 "NOT_FOUND"。
    expect(body.error.code).toBe("SOURCE_NOT_FOUND");
  });

  it("非法形状 sourceKey → 400 INVALID_SOURCE_KEY(不是 404,证明校验先于 resolve 执行)", async () => {
    const res = await api.GET(new Request("http://localhost/api/config/source/not-hex-shaped"));
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("INVALID_SOURCE_KEY");
  });
});

describe("PUT /api/config/source/:sourceKey(经真实 handler)", () => {
  it("路由已挂载:同一占位 resolver 下 PUT 也是业务层 404(SOURCE_NOT_FOUND)", async () => {
    const res = await api.PUT(
      new Request(`http://localhost/api/config/source/${VALID_SHAPE_SOURCE_KEY}`, {
        method: "PUT",
        body: JSON.stringify({ values: { foo: "bar" } }),
      }),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("SOURCE_NOT_FOUND");
  });
});

// 补task 2.3:生产 resolveSettings 接线(sourceKey → packageDir)——用真实 fixture agent
// (`settings-assembly-source-e2e-agent`,manifest 声明 `settings.scope:"source"`,
// `fields:[]`)验证「候选目录 → resolvePiPlugin → descriptor.id → sourceKey 命中匹配」
// 全链路,以及 GET/PUT 落盘回读。
describe("GET|PUT /api/config/source/:sourceKey(经生产 resolveSettings,真实 fixture)", () => {
  // `descriptor.id` 取 `pi-web.json#id`(见 fixture manifest),与
  // `resolveAssemblySourceSettings`(任务 3.1)对同一 fixture 解析出的 sourceKey 一致。
  const fixtureSourceKey = sourceKey("settings-assembly-source-e2e-agent");

  it("GET 命中真实 source:200 + 该 source 的 schema/scope(不再是占位 404)", async () => {
    const res = await api.GET(
      new Request(`http://localhost/api/config/source/${fixtureSourceKey}`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      schema: { fields: unknown[] };
      values: Record<string, unknown>;
      scope: string;
    };
    expect(body.scope).toBe("source");
    expect(body.schema.fields).toEqual([]);
    expect(body.values).toEqual({});
  });

  it("PUT 落盘后 GET 回读同一值(scope=source 落于 <agentDir>/sources/<sourceKey>/settings.json)", async () => {
    const putRes = await api.PUT(
      new Request(`http://localhost/api/config/source/${fixtureSourceKey}`, {
        method: "PUT",
        body: JSON.stringify({ values: { note: "hello-2.3" } }),
      }),
    );
    expect(putRes.status).toBe(200);

    const getRes = await api.GET(
      new Request(`http://localhost/api/config/source/${fixtureSourceKey}`),
    );
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as { values: Record<string, unknown> };
    expect(body.values).toEqual({ note: "hello-2.3" });
  });

  it("未知 sourceKey 仍 404 SOURCE_NOT_FOUND(生产 resolver 下同样归一,不泄露候选目录集合)", async () => {
    const res = await api.GET(
      new Request(`http://localhost/api/config/source/${VALID_SHAPE_SOURCE_KEY}`),
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("SOURCE_NOT_FOUND");
  });
});

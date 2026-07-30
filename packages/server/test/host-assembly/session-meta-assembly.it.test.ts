/**
 * 装配接线:元数据索引与活跃态查询经 HostDeps 抵达 session.list / session.actions
 * (spec session-meta-index, 任务 3.4 / Req 1.1, 1.2, 5.1, 7.5)。
 *
 * ★ 判据取**真实响应体**:既有装配守卫②(路由集等价)对「透传了没有」零判别力 ——
 *   两侧都不传依赖时路由 `{method,path}` 完全相同,漏一根接线照样绿。所以这里必须
 *   真的发一次 `GET /sessions` 看 `source` / `activity` 有没有出现。
 *
 * ★ 任务清单原把本文件划在 `packages/core/test/integration/`,但 `defaultCapabilities`
 *   在 server 包、core 不能反向依赖 server,故落在此处(边界调整已记入 tasks.md)。
 */
import { mkdtempSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  ListSessionsResponseSchema,
  type SessionActivity,
} from "@blksails/pi-web-protocol";
import {
  defaultCapabilities,
  type HostDeps,
} from "../../src/host-assembly/default-capabilities.js";
import type { HostContribution } from "../../src/host-assembly/host-contribution.js";
import {
  composeCapabilities,
  HOST_CAPABILITY_IDS_V1,
  type CapabilityDecision,
} from "@blksails/pi-web-core/host-manifest/index.js";
import { InMemorySessionStore } from "@blksails/pi-web-core/session/session-store.js";
import { SessionManager } from "@blksails/pi-web-core/session/session-manager.js";
import { AttachmentStore } from "@blksails/pi-web-core/attachment/attachment-store.js";
import { createUrlSigner } from "@blksails/pi-web-core/attachment/url-signer.js";
import { LocalFsBlobBackend } from "@blksails/pi-web-core/attachment/local-fs-backend.js";
import { AttachmentRegistry } from "@blksails/pi-web-core/attachment/attachment-registry.js";
import { createPiWebHandler } from "@blksails/pi-web-core/http/index.js";
import { FsSessionEntryStore } from "@blksails/pi-web-core/session-store/index.js";
import { JsonFileSessionMetaIndex } from "@blksails/pi-web-core/session-meta/index.js";
import type { PiCli } from "@blksails/pi-web-adapters/extensions/ext.types.js";

const mkTmp = (prefix: string): string => mkdtempSync(join(tmpdir(), prefix));

function stubPiCli(): PiCli {
  return {
    install: vi.fn(async () => ({ ok: true as const })),
    uninstall: vi.fn(async () => ({ ok: true as const })),
    list: vi.fn(async () => []),
  } as unknown as PiCli;
}

interface Wired {
  readonly fetch: (req: Request) => Promise<Response>;
  readonly sessionsRoot: string;
  readonly metaIndex: JsonFileSessionMetaIndex;
}

/**
 * 走**完整装配路径**:buildDeps → defaultCapabilities → composeCapabilities(全 use)
 * → 把产出的路由塞进 createPiWebHandler。任何一处漏传 deps 都会在响应体上现形。
 */
function wire(activityOf?: (sessionId: string) => SessionActivity | undefined): Wired {
  const agentDir = mkTmp("meta-asm-agent-");
  const defaultCwd = mkTmp("meta-asm-cwd-");
  const attachmentRoot = mkTmp("meta-asm-attach-");
  const sessionsRoot = join(agentDir, "sessions");

  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store });
  const signer = createUrlSigner("test-secret-stable");
  const backend = new LocalFsBlobBackend(attachmentRoot, signer);
  const registry = new AttachmentRegistry(attachmentRoot);
  const attachmentStore = new AttachmentStore({ blob: backend, registry, signer, backend });
  const metaIndex = new JsonFileSessionMetaIndex({
    path: join(agentDir, "piweb-session-index.json"),
  });

  const deps: HostDeps = {
    agentDir,
    defaultCwd,
    listModelOptions: () => ({ providers: [], models: [] }),
    resolveSourceSettings: async () => undefined,
    onSourceSettingsSaved: () => {},
    sessionStoreConfig: { kind: "fs", root: sessionsRoot },
    sessionsManageEnabled: true,
    sourcesScanRoots: [],
    sourcesRegistryPath: join(agentDir, "agent-sources-registry.json"),
    attachmentStore,
    resolveWriteBackend: () => undefined,
    store,
    bashEnabled: true,
    extension: { piCli: stubPiCli(), store, manager },
    hostCommandHandlers: [],
    // ★ 本测试的被验对象:这两根接线
    sessionMetaIndex: metaIndex,
    ...(activityOf !== undefined ? { sessionActivityOf: activityOf } : {}),
  };

  const descriptors = defaultCapabilities(deps);
  const decisions: Record<string, CapabilityDecision<HostDeps, HostContribution>> = {};
  for (const id of HOST_CAPABILITY_IDS_V1) decisions[id] = { kind: "use" };
  const composed = composeCapabilities({ descriptors, decisions, deps });
  const routes = composed
    .filter((c): c is Extract<HostContribution, { kind: "route" }> => c.kind === "route")
    .map((c) => c.route);

  return {
    fetch: createPiWebHandler({
      manager,
      store,
      routes,
      authResolver: () => ({ anonymous: true }),
    }),
    sessionsRoot,
    metaIndex,
  };
}

async function seed(sessionsRoot: string, id: string, cwd: string): Promise<void> {
  await mkdir(sessionsRoot, { recursive: true });
  const entryStore = new FsSessionEntryStore(sessionsRoot);
  await entryStore.create({
    type: "session",
    id,
    version: 1,
    cwd,
    timestamp: "2026-06-01T00:00:01.000Z",
  });
}

async function listSessions(
  w: Wired,
  cwd: string,
): Promise<ReturnType<typeof ListSessionsResponseSchema.parse>> {
  const res = await w.fetch(new Request("http://x/sessions"));
  expect(res.status).toBe(200);
  return ListSessionsResponseSchema.parse(JSON.parse(await res.text()));
}

describe("装配接线经真实响应体验证(任务 3.4)", () => {
  it("元数据索引抵达 session.list:响应体带 source 与索引标题", async () => {
    const cwd = "/tmp/meta-asm-projA";
    const w = wire();
    await seed(w.sessionsRoot, "s1", cwd);
    await w.metaIndex.merge("s1", {
      title: "装配后的标题",
      agentSource: "builtin:assembled",
    });
    const body = await listSessions(w, cwd);
    const item = body.sessions.find((s) => s.sessionId === "s1");
    expect(item?.source).toBe("builtin:assembled");
    expect(item?.name).toBe("装配后的标题");
  });

  it("活跃态查询抵达 session.list:响应体带 activity", async () => {
    const cwd = "/tmp/meta-asm-projB";
    const w = wire((id) => (id === "s1" ? "awaiting-input" : undefined));
    await seed(w.sessionsRoot, "s1", cwd);
    await seed(w.sessionsRoot, "s2", cwd);
    const body = await listSessions(w, cwd);
    expect(body.sessions.find((s) => s.sessionId === "s1")?.activity).toBe(
      "awaiting-input",
    );
    expect(body.sessions.find((s) => s.sessionId === "s2")?.activity).toBeUndefined();
  });

  it("元数据索引抵达 session.actions:删除会话后索引条目被清", async () => {
    const cwd = "/tmp/meta-asm-projC";
    const w = wire();
    await seed(w.sessionsRoot, "s1", cwd);
    await w.metaIndex.merge("s1", { title: "待删", agentSource: "builtin:x" });
    const res = await w.fetch(
      new Request("http://x/sessions/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1" }),
      }),
    );
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      expect((await w.metaIndex.read()).has("s1")).toBe(false);
    });
  });

  it("改名经 session.actions 后索引标题更新", async () => {
    const cwd = "/tmp/meta-asm-projD";
    const w = wire();
    await seed(w.sessionsRoot, "s1", cwd);
    const res = await w.fetch(
      new Request("http://x/sessions/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "s1", name: "改过的名字" }),
      }),
    );
    expect(res.status).toBe(200);
    await vi.waitFor(async () => {
      expect((await w.metaIndex.read()).get("s1")?.title).toBe("改过的名字");
    });
    // 再列一次:标题来自索引
    const body = await listSessions(w, cwd);
    expect(body.sessions.find((s) => s.sessionId === "s1")?.name).toBe("改过的名字");
  });

  it("索引中无来源的会话不得凭空出现 source(避免 cwd 冒充)", async () => {
    const cwd = "/tmp/meta-asm-projE";
    const w = wire();
    await seed(w.sessionsRoot, "s1", cwd);
    const body = await listSessions(w, cwd);
    expect(body.sessions.find((s) => s.sessionId === "s1")?.source).toBeUndefined();
  });
});

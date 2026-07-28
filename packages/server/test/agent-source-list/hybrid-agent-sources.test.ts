/**
 * Hybrid agent-sources 端到端路径(注入 provider + 真实 routes handler)。
 * 覆盖:无凭据仅本地 / 登录并集 / 线上失败本地仍在 / 响应无 token。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ListAgentSourcesResponseSchema } from "@blksails/pi-web-protocol";
import { createPiWebHandler } from "../../src/http/index.js";
import { InMemorySessionStore } from "../../src/session/session-store.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { createAgentSourcesRoutes } from "../../src/agent-source-list/agent-sources-routes.js";
import { createCompositeSourceProvider } from "../../src/agent-source-list/composite-provider.js";
import { createScanSourceProvider } from "../../src/agent-source-list/scan-provider.js";
import {
  createRegistryHttpSourceProvider,
  type RegistryFetch,
} from "../../src/agent-source-list/registry-http-provider.js";
import {
  createDesktopCapabilitiesClient,
  type CapabilitiesFetch,
} from "../../src/auth/desktop-capabilities-client.js";
import type { AgentSourceProvider } from "../../src/agent-source-list/types.js";

let scanRoot: string;

beforeEach(async () => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  scanRoot = join(tmpdir(), `hybrid-scan-${stamp}`);
  await fs.mkdir(scanRoot, { recursive: true });
  const agentDir = join(scanRoot, "local-agent");
  await fs.mkdir(agentDir, { recursive: true });
  await fs.writeFile(join(agentDir, "index.ts"), "export default {}\n");
  await fs.writeFile(
    join(agentDir, "package.json"),
    JSON.stringify({ name: "local-agent", "pi-web": { title: "Local Agent" } }),
  );
});

afterEach(async () => {
  await fs.rm(scanRoot, { recursive: true, force: true });
});

async function readJson(res: Response): Promise<unknown> {
  return JSON.parse(await res.text());
}

function makeHandler(provider: AgentSourceProvider) {
  const store = new InMemorySessionStore(true);
  const manager = new SessionManager({ store, idleMs: 0 });
  const routes = createAgentSourcesRoutes({
    scanRoots: [],
    registryPath: join(scanRoot, "no-reg.json"),
    provider,
  });
  return createPiWebHandler({
    manager,
    store,
    routes,
    authResolver: () => ({ anonymous: true }),
  });
}

describe("hybrid GET /agent-sources", () => {
  it("无凭据 → 仅本地扫描,不打 capabilities/registry", async () => {
    const capFetch = vi.fn<CapabilitiesFetch>();
    const regFetch = vi.fn<RegistryFetch>();
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => undefined,
      fetchImpl: capFetch,
    });
    const provider = createCompositeSourceProvider(
      createRegistryHttpSourceProvider({
        getGrant: () => client.getSourcesGrant(),
        fetchImpl: regFetch,
      }),
      createScanSourceProvider({ roots: [scanRoot] }),
    );
    const handler = makeHandler(provider);
    const res = await handler(new Request("http://x/agent-sources"));
    expect(res.status).toBe(200);
    const parsed = ListAgentSourcesResponseSchema.parse(await readJson(res));
    expect(parsed.sources.map((s) => s.name)).toContain("local-agent");
    expect(parsed.sources.every((s) => s.origin === "scan")).toBe(true);
    expect(capFetch).not.toHaveBeenCalled();
    expect(regFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(parsed)).not.toMatch(/Bearer |consume|secret/i);
  });

  it("有凭据 + mock 云 → 本地 ∪ 线上 id@channel", async () => {
    const capFetch: CapabilitiesFetch = async () => ({
      status: 200,
      text: async () =>
        JSON.stringify({
          sources: {
            baseUrl: "https://registry.example/v1",
            token: "consume-SECRET-xyz",
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          },
        }),
    });
    const regFetch: RegistryFetch = async (url, init) => {
      expect(url).toBe("https://registry.example/v1/sources");
      expect(init.headers.authorization).toBe("Bearer consume-SECRET-xyz");
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            sources: [
              {
                id: "acme/cloud-bot",
                displayName: "Cloud Bot",
                kind: "agent",
              },
              { id: "acme/plugin-x", displayName: "Plug", kind: "plugin" },
            ],
          }),
      };
    };
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "desktop.cred",
      fetchImpl: capFetch,
    });
    const provider = createCompositeSourceProvider(
      createRegistryHttpSourceProvider({
        getGrant: () => client.getSourcesGrant(),
        fetchImpl: regFetch,
      }),
      createScanSourceProvider({ roots: [scanRoot] }),
    );
    const handler = makeHandler(provider);
    const res = await handler(new Request("http://x/agent-sources"));
    const parsed = ListAgentSourcesResponseSchema.parse(await readJson(res));
    const ids = parsed.sources.map((s) => s.id);
    expect(ids).toContain("acme/cloud-bot");
    expect(ids.some((id) => id.includes("local-agent"))).toBe(true);
    expect(ids).not.toContain("acme/plugin-x");
    const cloud = parsed.sources.find((s) => s.id === "acme/cloud-bot")!;
    expect(cloud.source).toBe("acme/cloud-bot@stable");
    expect(cloud.origin).toBe("registry");
    expect(JSON.stringify(parsed)).not.toContain("consume-SECRET-xyz");
  });

  it("有凭据但线上失败 → 本地仍在,不 500", async () => {
    const client = createDesktopCapabilitiesClient({
      capabilitiesUrl: "https://cloud.example/api/desktop/capabilities",
      getDesktopCredential: () => "desktop.cred",
      fetchImpl: async () => ({
        status: 503,
        text: async () => "unavailable",
      }),
    });
    const provider = createCompositeSourceProvider(
      createRegistryHttpSourceProvider({
        getGrant: () => client.getSourcesGrant(),
        fetchImpl: async () => {
          throw new Error("should not reach registry");
        },
      }),
      createScanSourceProvider({ roots: [scanRoot] }),
    );
    const handler = makeHandler(provider);
    const res = await handler(new Request("http://x/agent-sources"));
    expect(res.status).toBe(200);
    const parsed = ListAgentSourcesResponseSchema.parse(await readJson(res));
    expect(parsed.sources.length).toBeGreaterThanOrEqual(1);
    expect(parsed.sources.every((s) => s.origin === "scan")).toBe(true);
  });
});

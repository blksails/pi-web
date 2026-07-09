/**
 * 配置门控的加载态(spec vite-spa-migration,Req 3.5)。
 *
 * 配置未到达前**不渲染**依赖门控的子树 —— 否则像 Tier4 隔离表面这类「按门控决定是否挂载」
 * 的组件会先按缺省值渲染一次再纠正,产生闪烁与误导。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import { BootstrapGate } from "@/src/bootstrap";
import { resetRuntimeFeatures } from "@/lib/app/runtime-features";

const PAYLOAD = {
  defaultCwd: "/tmp/x",
  autoStart: false,
  multiTenant: false,
  hostApiVersion: "0.1.0",
  features: {
    canvas: true,
    sourcePicker: false,
    launcherRail: false,
    bashEnabled: false,
    sessionsGlobal: false,
    sessionsManage: true,
    sessionsSlot: "sidebar",
    extensionCommands: "",
    extensionAllowlist: "",
    extensionBaseUrl: "",
    disableReadinessHandshake: false,
  },
};

function deferredFetch(): {
  fetchImpl: typeof fetch;
  resolve: () => void;
} {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const fetchImpl = (async () => {
    await gate;
    return {
      ok: true,
      json: async () => PAYLOAD,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, resolve: release };
}

afterEach(() => {
  cleanup();
  resetRuntimeFeatures();
});

describe("BootstrapGate", () => {
  it("配置未到达时呈现加载态,且不渲染子树(Req 3.5)", async () => {
    const { fetchImpl } = deferredFetch();
    render(
      <BootstrapGate fetchImpl={fetchImpl}>
        <div data-testid="gated-subtree">gated</div>
      </BootstrapGate>,
    );
    expect(document.querySelector('[data-pi-bootstrap="loading"]')).not.toBeNull();
    expect(screen.queryByTestId("gated-subtree")).toBeNull();
  });

  it("配置到达后渲染子树", async () => {
    const { fetchImpl, resolve } = deferredFetch();
    render(
      <BootstrapGate fetchImpl={fetchImpl}>
        <div data-testid="gated-subtree">gated</div>
      </BootstrapGate>,
    );
    expect(screen.queryByTestId("gated-subtree")).toBeNull();
    resolve();
    await waitFor(() => expect(screen.getByTestId("gated-subtree")).toBeTruthy());
    expect(document.querySelector('[data-pi-bootstrap="ready"]')).not.toBeNull();
  });

  it("配置拉取失败 → 错误态,仍不渲染子树", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500 })) as unknown as typeof fetch;
    render(
      <BootstrapGate fetchImpl={fetchImpl}>
        <div data-testid="gated-subtree">gated</div>
      </BootstrapGate>,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-pi-bootstrap="error"]')).not.toBeNull(),
    );
    expect(screen.queryByTestId("gated-subtree")).toBeNull();
  });

  it("就绪时把门控注入运行时门控源(供 chat-app 的惰性求值读取)", async () => {
    const { fetchImpl, resolve } = deferredFetch();
    render(
      <BootstrapGate fetchImpl={fetchImpl}>
        <div data-testid="gated-subtree">gated</div>
      </BootstrapGate>,
    );
    resolve();
    await waitFor(() => expect(screen.getByTestId("gated-subtree")).toBeTruthy());
    const { getRuntimeFeatures } = await import("@/lib/app/runtime-features");
    expect(getRuntimeFeatures().canvas).toBe(true);
    expect(getRuntimeFeatures().hostApiVersion).toBe("0.1.0");
  });
});

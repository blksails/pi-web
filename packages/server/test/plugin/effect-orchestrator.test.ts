/**
 * 单元:装后双路生效编排 runInstallEffects(spec: plugin-system-unification,Req 7.2/7.3/7.4)。
 * 覆盖仅 pi / 仅 webext / 双层三分支,以及任一路失败不阻断另一路。
 */
import { describe, it, expect, vi } from "vitest";
import { runInstallEffects } from "../../src/plugin/effect-orchestrator.js";
import type { PluginDescriptor } from "../../src/plugin/plugin.types.js";

function descriptor(over: Partial<PluginDescriptor>): PluginDescriptor {
  return {
    id: "p",
    version: "1.0.0",
    pi: { extensions: [], skills: [], prompts: [], themes: [] },
    webCommands: [],
    diagnostics: [],
    ...over,
  };
}

const sessionId = "s1";
const source = "local:x";

describe("runInstallEffects", () => {
  it("仅 pi 资源:reload ok,webext skipped", async () => {
    const reloadRuntime = vi.fn(async () => undefined);
    const signalWebextReload = vi.fn();
    const d = descriptor({ pi: { extensions: ["extensions/x.ts"], skills: [], prompts: [], themes: [] } });

    const r = await runInstallEffects({ sessionId, source, descriptor: d }, { reloadRuntime, signalWebextReload });

    expect(r).toEqual({ reload: "ok", webext: "skipped" });
    expect(reloadRuntime).toHaveBeenCalledOnce();
    expect(signalWebextReload).not.toHaveBeenCalled();
  });

  it("仅 webext:reload skipped,webext signaled", async () => {
    const reloadRuntime = vi.fn(async () => undefined);
    const signalWebextReload = vi.fn();
    const d = descriptor({ web: { dist: ".pi/web/dist" } });

    const r = await runInstallEffects({ sessionId, source, descriptor: d }, { reloadRuntime, signalWebextReload });

    expect(r).toEqual({ reload: "skipped", webext: "signaled" });
    expect(reloadRuntime).not.toHaveBeenCalled();
    expect(signalWebextReload).toHaveBeenCalledOnce();
  });

  it("双层:reload ok + webext signaled", async () => {
    const reloadRuntime = vi.fn(async () => undefined);
    const signalWebextReload = vi.fn();
    const d = descriptor({
      pi: { extensions: ["extensions/x.ts"], skills: [], prompts: [], themes: [] },
      web: { dist: ".pi/web/dist" },
    });

    const r = await runInstallEffects({ sessionId, source, descriptor: d }, { reloadRuntime, signalWebextReload });

    expect(r).toEqual({ reload: "ok", webext: "signaled" });
  });

  it("reload 抛错:返回 {error},webext 仍 signaled(不阻断)", async () => {
    const reloadRuntime = vi.fn(async () => {
      throw new Error("boom");
    });
    const signalWebextReload = vi.fn();
    const d = descriptor({
      pi: { extensions: ["extensions/x.ts"], skills: [], prompts: [], themes: [] },
      web: { dist: ".pi/web/dist" },
    });

    const r = await runInstallEffects({ sessionId, source, descriptor: d }, { reloadRuntime, signalWebextReload });

    expect(r.reload).toEqual({ error: "boom" });
    expect(r.webext).toBe("signaled");
    expect(signalWebextReload).toHaveBeenCalledOnce();
  });

  it("webext 抛错:返回 {error},reload 仍 ok(不阻断)", async () => {
    const reloadRuntime = vi.fn(async () => undefined);
    const signalWebextReload = vi.fn(() => {
      throw new Error("webext-fail");
    });
    const d = descriptor({
      pi: { extensions: ["extensions/x.ts"], skills: [], prompts: [], themes: [] },
      web: { dist: ".pi/web/dist" },
    });

    const r = await runInstallEffects({ sessionId, source, descriptor: d }, { reloadRuntime, signalWebextReload });

    expect(r.reload).toBe("ok");
    expect(r.webext).toEqual({ error: "webext-fail" });
  });
});

/**
 * 图像工具终止行为测试(spec aigc-tool-abort)。
 *
 * ★ 立项动机来自真机探针:点停止后**并非总能停下来**。分段实测 ——
 *   provider 请求 / 异步轮询 / SSE 流 / prompt 优化 → 均可中断(既有能力);
 *   **产出图落盘下载 → 停不掉**(`fetchImpl(url)` 不传 init,signal 无从进入),
 *   用户只能干等 PERSIST_TIMEOUT_MS = 30s;下载与 arrayBuffer 各一个窗口,最坏 60s。
 *
 * 本套件把补齐后的行为钉死,重点是三条:落盘可中断、终止零入库、终止可识别。
 */
import { describe, it, expect, vi } from "vitest";
import { runImageTool } from "../../src/aigc/run-image-tool.js";
import { persistPicked } from "../../src/attachment/persist.js";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import type { ImageRoute, InteractionParam, ToolExecuteDetails } from "../../src/aigc/types.js";

const PROVIDER_HOST = "https://api.example.com";
const CDN = "https://cdn.example.com";

function route(urls: readonly string[] = [`${CDN}/out0.png`]): ImageRoute {
  return {
    model: "m",
    label: "M",
    url: `${PROVIDER_HOST}/run`,
    headers: {},
    requiredVars: [],
    buildBody: () => ({ p: 1 }),
    pickResult: () =>
      urls.length === 1
        ? { kind: "image", url: urls[0] as string }
        : { kind: "image-set", urls: [...urls] },
  };
}

const OPTS = {
  toolName: "image_generation",
  defaultModel: "m",
  requiredParams: [] as readonly InteractionParam[],
  mediaFields: [] as readonly string[],
};

function makeCtx(): { ctx: AttachmentToolContext; putOutput: ReturnType<typeof vi.fn> } {
  const putOutput = vi.fn(async ({ name }: { name: string }) => ({
    attachmentId: `att_${name}`,
    displayUrl: `/a/${name}`,
    mimeType: "image/png",
    name,
  }));
  return { ctx: { available: true, putOutput } as unknown as AttachmentToolContext, putOutput };
}

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]);

function okJson(): Response {
  return new Response(JSON.stringify({ ok: 1 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
function okPng(): Response {
  return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
}

// ── 1/2/4:落盘下载可中断 + 终止零入库 ────────────────────────────────────────

describe("落盘下载阶段可中断(Req 1.2/1.5/3.1)", () => {
  it("★ 下载中 abort → 1 秒内结束(改动前为 5s+ 未结束,只能等 30s 超时)", async () => {
    const ac = new AbortController();
    const { ctx, putOutput } = makeCtx();
    let sawSignal = false;

    const fetchImpl = vi.fn((u: string | URL, init?: RequestInit) => {
      if (String(u).startsWith(PROVIDER_HOST)) return Promise.resolve(okJson());
      // 落盘下载:永不自然返回,只有 abort 才结束 —— 模拟慢速/挂起的 CDN。
      if (init?.signal) sawSignal = true;
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        );
      });
    }) as unknown as typeof fetch;

    const startedAt = Date.now();
    const p = runImageTool({ prompt: "x" }, undefined as never, ac.signal, undefined, {
      ...OPTS,
      routes: [route()],
      deps: { getCtx: () => ctx, fetchImpl },
    });
    setTimeout(() => ac.abort(), 30);
    const result = await p;
    const elapsed = Date.now() - startedAt;

    expect(sawSignal, "signal 必须进入落盘下载的 fetch init").toBe(true);
    expect(elapsed, `应在 1s 内结束,实际 ${elapsed}ms`).toBeLessThan(1000);
    expect((result.details as { ok: boolean }).ok).toBe(false);
    // Req 3.1:终止后零入库。
    expect(putOutput).not.toHaveBeenCalled();
  }, 10_000);

  it("★ 多图:第 1 张已下完、第 2 张下载中 abort → putOutput 仍为零次(Req 3.2)", async () => {
    const ac = new AbortController();
    const { ctx, putOutput } = makeCtx();

    const fetchImpl = vi.fn((u: string | URL, init?: RequestInit) => {
      const url = String(u);
      if (url.startsWith(PROVIDER_HOST)) return Promise.resolve(okJson());
      if (url.endsWith("out0.png")) return Promise.resolve(okPng()); // 第 1 张立刻下完
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        );
      });
    }) as unknown as typeof fetch;

    const p = runImageTool({ prompt: "x" }, undefined as never, ac.signal, undefined, {
      ...OPTS,
      routes: [route([`${CDN}/out0.png`, `${CDN}/out1.png`])],
      deps: { getCtx: () => ctx, fetchImpl },
    });
    setTimeout(() => ac.abort(), 50);
    const result = await p;

    expect((result.details as { ok: boolean }).ok).toBe(false);
    // 这正是「下载与入库拆两阶段」要保证的:第 1 张虽已下完,也不得入库成孤儿附件。
    expect(putOutput, "已下完的那张也不得入库").not.toHaveBeenCalled();
  }, 10_000);

  it("persistPicked 单独调用时同样把 signal 交给下载", async () => {
    const ac = new AbortController();
    const { ctx } = makeCtx();
    let seen: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_u: string | URL, init?: RequestInit) => {
      seen = init?.signal ?? undefined;
      return okPng();
    }) as unknown as typeof fetch;

    await persistPicked({ kind: "image", url: `${CDN}/a.png` }, ctx, {
      fetchImpl,
      signal: ac.signal,
    });
    expect(seen).toBe(ac.signal);
  });

  it("下载全部完成后、入库前 abort → 仍不入库(覆盖最后一张刚下完的窗口)", async () => {
    const ac = new AbortController();
    const { ctx, putOutput } = makeCtx();
    const fetchImpl = vi.fn(async () => {
      ac.abort(); // 下载返回的同时用户点了停止
      return okPng();
    }) as unknown as typeof fetch;

    await expect(
      persistPicked({ kind: "image", url: `${CDN}/a.png` }, ctx, {
        fetchImpl,
        signal: ac.signal,
      }),
    ).rejects.toThrow();
    expect(putOutput).not.toHaveBeenCalled();
  });
});

// ── 5/6:终止的识别与表达 ────────────────────────────────────────────────────

describe("终止后的用户反馈(Req 2.1/2.2/2.3)", () => {
  it("★ 终止结果描述可识别为「取消」,且与真实失败可区分", async () => {
    const ac = new AbortController();
    const { ctx } = makeCtx();
    const fetchImpl = vi.fn((u: string | URL, init?: RequestInit) => {
      if (String(u).startsWith(PROVIDER_HOST)) return Promise.resolve(okJson());
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener("abort", () =>
          rej(new DOMException("aborted", "AbortError")),
        );
      });
    }) as unknown as typeof fetch;

    const p = runImageTool({ prompt: "x" }, undefined as never, ac.signal, undefined, {
      ...OPTS,
      routes: [route()],
      deps: { getCtx: () => ctx, fetchImpl },
    });
    setTimeout(() => ac.abort(), 30);
    const details = (await p).details as ToolExecuteDetails;

    expect(details.ok).toBe(false);
    if (details.ok === false) {
      expect(details.error).toContain("已取消");
      // 关键:不能显示成「生成失败」——那看起来像出了故障,而不是用户自己按的停止。
      expect(details.error).not.toContain("生成失败");
    }
  }, 10_000);

  it("真实失败仍报「生成失败」,不被误标成取消", async () => {
    const { ctx } = makeCtx();
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ error: { message: "bad key" } }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;

    const details = (
      await runImageTool({ prompt: "x" }, undefined as never, undefined, undefined, {
        ...OPTS,
        routes: [route()],
        deps: { getCtx: () => ctx, fetchImpl },
      })
    ).details as ToolExecuteDetails;

    expect(details.ok).toBe(false);
    if (details.ok === false) expect(details.error).not.toContain("已取消");
  }, 10_000);

  it("★ 终止后不再推送流式预览(Req 2.3)", async () => {
    const ac = new AbortController();
    const { ctx } = makeCtx();
    const onUpdate = vi.fn();

    // 让 provider 请求挂住,abort 后再看是否还有 onUpdate。
    // ⚠ 必须先判 `signal.aborted`:若 abort 已经发生,再 addEventListener("abort") 不会触发
    // (事件早已派发完),promise 会永远挂着 —— 这是 AbortSignal 的常见测试陷阱。
    const fetchImpl = vi.fn((_u: string | URL, init?: RequestInit) => {
      const s = init?.signal;
      if (s?.aborted === true) return Promise.reject(new DOMException("aborted", "AbortError"));
      return new Promise<Response>((_res, rej) => {
        s?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
      });
    }) as unknown as typeof fetch;

    const p = runImageTool({ prompt: "x" }, undefined as never, ac.signal, onUpdate, {
      ...OPTS,
      routes: [route()],
      deps: { getCtx: () => ctx, fetchImpl },
    });
    ac.abort();
    await p;

    const afterAbort = onUpdate.mock.calls.filter((c) => {
      const d = (c[0] as { details?: { ok?: boolean } })?.details;
      return d?.ok === true;
    });
    expect(afterAbort, "终止后不应再推成功态预览帧").toHaveLength(0);
  }, 10_000);
});

// ── 7/8:不回归 ─────────────────────────────────────────────────────────────

describe("不回归既有行为(Req 4.1/4.2/4.3)", () => {
  it("未终止的正常路径:产物顺序、命名、形态不变", async () => {
    const { ctx, putOutput } = makeCtx();
    const fetchImpl = vi.fn(async (u: string | URL) =>
      String(u).startsWith(PROVIDER_HOST) ? okJson() : okPng(),
    ) as unknown as typeof fetch;

    const result = await runImageTool({ prompt: "雪山" }, undefined as never, undefined, undefined, {
      ...OPTS,
      routes: [route([`${CDN}/out0.png`, `${CDN}/out1.png`])],
      deps: { getCtx: () => ctx, fetchImpl },
    });

    const d = result.details as ToolExecuteDetails;
    expect(d.ok).toBe(true);
    if (d.ok) {
      expect(d.assets).toHaveLength(2);
      // 顺序与输入一致(两阶段拆分后仍由 index 保序)。
      expect(d.assets[0]?.name).toMatch(/-0\.png$/);
      expect(d.assets[1]?.name).toMatch(/-1\.png$/);
    }
    expect(putOutput).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("未传 signal 时行为完全不变(超时兜底仍在,不因缺 signal 而报错)", async () => {
    const { ctx, putOutput } = makeCtx();
    const fetchImpl = vi.fn(async (u: string | URL) =>
      String(u).startsWith(PROVIDER_HOST) ? okJson() : okPng(),
    ) as unknown as typeof fetch;

    await persistPicked({ kind: "image", url: `${CDN}/a.png` }, ctx, { fetchImpl });
    expect(putOutput).toHaveBeenCalledTimes(1);
  });

  it("inline data URI 产物不经网络,终止与否都正常入库", async () => {
    const { ctx, putOutput } = makeCtx();
    const dataUri = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
    await persistPicked({ kind: "image", url: dataUri }, ctx, {});
    expect(putOutput).toHaveBeenCalledTimes(1);
  });
});

/**
 * 反向拉取的宿主应答（spec ai-gateway-catalog-coldstart，任务 2.2）。
 *
 * 判据聚焦三件事：
 *  1. 目录未就绪时**会等**，等到即以 `ready` 给出清单（Req 1.1）——这是本 spec 的核心；
 *  2. 上游始终不可达时**不挂起**，超时以 `timeout` 如实作答（Req 3.3）；
 *  3. 四种成因保持可判别（Req 4.1）——尤其 `timeout`（还没拉到）与 `ready` + 空数组
 *     （拉到了但收敛后确实为空）不得合并。
 */
import { describe, expect, it, vi } from "vitest";
import { makeGatewayModelsResolver } from "../lib/app/ai-gateway-models-resolver.js";

type Entry = { model: string; ownedBy: string; source: "ai-gateway"; instanceId: string };

function entriesOf(...models: string[]): Entry[] {
  return models.map((m) => ({
    model: m,
    ownedBy: "anthropic",
    source: "ai-gateway" as const,
    instanceId: "cf",
  }));
}

/**
 * 受控目录替身：`get()` 返回当前快照，`refresh()` 按注入的行为决定是否填充快照。
 * 这就是「主动构造目录未就绪窗口」的接缝——不依赖真实时序巧合（Req 6.1）。
 */
function fakeCatalog(opts: {
  initial?: Entry[];
  onRefresh?: () => Entry[] | Promise<Entry[]>;
  /** 永不 settle：模拟上游不可达。 */
  hang?: boolean;
}) {
  let snapshot: Entry[] = opts.initial ?? [];
  return {
    get: () => snapshot,
    refresh: async () => {
      if (opts.hang === true) {
        await new Promise<void>(() => {
          /* 永不 resolve */
        });
        return;
      }
      const next = await (opts.onRefresh?.() ?? []);
      snapshot = next;
    },
    /** 测试观测:当前快照条数。 */
    size: () => snapshot.length,
  };
}

const instances = [{ id: "cf" }] as never;
const silent = { info: () => {} };

describe("makeGatewayModelsResolver — 目录未就绪时的等待(Req 1.1)", () => {
  it("★ 快照为空 → 触发 refresh 并等待,拿到后以 ready 给出清单", async () => {
    const catalog = fakeCatalog({
      initial: [],
      onRefresh: () => entriesOf("anthropic/claude-opus-5", "openai/gpt-5.5"),
    });
    const resolve = makeGatewayModelsResolver({
      catalogs: new Map([["cf", catalog]]) as never,
      instances,
      waitMs: 1_000,
      logger: silent,
    });
    const r = await resolve(["cf"]);
    expect(r.reason).toBe("ready");
    expect(r.instances[0]?.models).toEqual([
      "anthropic/claude-opus-5",
      "openai/gpt-5.5",
    ]);
  });

  it("快照已就绪 → 直接作答,不触发 refresh(快路径不产生额外上游请求)", async () => {
    const onRefresh = vi.fn(() => entriesOf("x/y"));
    const catalog = fakeCatalog({ initial: entriesOf("anthropic/claude-opus-5"), onRefresh });
    const resolve = makeGatewayModelsResolver({
      catalogs: new Map([["cf", catalog]]) as never,
      instances,
      waitMs: 1_000,
      logger: silent,
    });
    const r = await resolve(["cf"]);
    expect(r.reason).toBe("ready");
    expect(onRefresh).not.toHaveBeenCalled();
  });
});

describe("makeGatewayModelsResolver — 成因可判别(Req 3.3/4.1)", () => {
  it("★ 上游不可达 → 不挂起,超时以 timeout 作答", async () => {
    const catalog = fakeCatalog({ initial: [], hang: true });
    const resolve = makeGatewayModelsResolver({
      catalogs: new Map([["cf", catalog]]) as never,
      instances,
      waitMs: 30,
      logger: silent,
    });
    const r = await resolve(["cf"]);
    expect(r.reason).toBe("timeout");
    expect(r.instances[0]?.models).toEqual([]);
  });

  // ★ 这条是 Req 4.1 的分界:两者都表现为「没有模型」,但一个可重试、一个是配置问题。
  //   若实现把它们合并成同一个 reason,本例即报红。
  it("★ 拉到了但收敛后为空 → ready + 空数组,与 timeout 不同", async () => {
    const catalog = fakeCatalog({ initial: [], onRefresh: () => [] });
    const resolve = makeGatewayModelsResolver({
      catalogs: new Map([["cf", catalog]]) as never,
      instances,
      waitMs: 1_000,
      logger: silent,
    });
    const r = await resolve(["cf"]);
    // refresh 成功但结果为空:不是 timeout
    expect(r.reason).toBe("ready");
    expect(r.instances[0]?.models).toEqual([]);
  });

  it("请求的实例宿主侧不存在 → unavailable(与前两者再区分)", async () => {
    const resolve = makeGatewayModelsResolver({
      catalogs: new Map() as never,
      instances,
      waitMs: 50,
      logger: silent,
    });
    const r = await resolve(["not-declared"]);
    expect(r.reason).toBe("unavailable");
    expect(r.instances).toEqual([]);
  });

  it("三种成因两两不等(可判别性本身)", async () => {
    const mk = (c: unknown, ids: string[]) =>
      makeGatewayModelsResolver({
        catalogs: c as never,
        instances,
        waitMs: 30,
        logger: silent,
      })(ids);
    const ready = await mk(
      new Map([["cf", fakeCatalog({ initial: entriesOf("a/b") })]]),
      ["cf"],
    );
    const timeout = await mk(
      new Map([["cf", fakeCatalog({ initial: [], hang: true })]]),
      ["cf"],
    );
    const unavailable = await mk(new Map(), ["nope"]);
    const reasons = [ready.reason, timeout.reason, unavailable.reason];
    expect(new Set(reasons).size).toBe(3);
  });
});

describe("makeGatewayModelsResolver — 收敛口径唯一(Req 5.3)", () => {
  // 不可对话的变体(如 :batch)由既有 isSessionCapableGatewayModel 剔除 —— 与装配层同一
  // 判据。若此处另写一套过滤,会话侧与部署级目录就会漂移。
  it("沿用既有的不可对话变体剔除判据,不另立一套过滤", async () => {
    const catalog = fakeCatalog({
      initial: entriesOf("anthropic/claude-opus-5", "openai/gpt-4-turbo:batch"),
    });
    const resolve = makeGatewayModelsResolver({
      catalogs: new Map([["cf", catalog]]) as never,
      instances,
      waitMs: 50,
      logger: silent,
    });
    const r = await resolve(["cf"]);
    expect(r.instances[0]?.models).toEqual(["anthropic/claude-opus-5"]);
  });
});

describe("makeGatewayModelsResolver — 可观测性(Req 4.2/4.3)", () => {
  it("记录补齐事件含实例标识与条数,且不含凭据", async () => {
    const lines: Array<{ msg: string; data?: Record<string, unknown> }> = [];
    const catalog = fakeCatalog({ initial: entriesOf("anthropic/claude-opus-5") });
    const resolve = makeGatewayModelsResolver({
      catalogs: new Map([["cf", catalog]]) as never,
      instances,
      waitMs: 50,
      logger: { info: (msg, data) => lines.push({ msg, ...(data ? { data } : {}) }) },
    });
    await resolve(["cf"]);
    const serialized = JSON.stringify(lines);
    expect(serialized).toContain("cf");
    expect(serialized).toContain("ready");
    // 凭据从不进入本模块的日志(本模块也从不接触 apiKey)
    expect(serialized).not.toMatch(/sk-|Bearer|apiKey/);
  });
});

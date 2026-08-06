/**
 * ai-gateway 会话模型清单反向拉取帧对的 schema 判据
 * （spec ai-gateway-catalog-coldstart，任务 2.1，Req 1.1/4.1）。
 */
import { describe, expect, it } from "vitest";
import {
  GATEWAY_MODELS_REQUEST_FRAME_TYPE,
  GATEWAY_MODELS_RESULT_FRAME_TYPE,
  GatewayModelsRequestFrameSchema,
  GatewayModelsResultFrameSchema,
} from "../../src/transport/gateway-models.js";

describe("GatewayModelsRequestFrameSchema — runner→宿主", () => {
  it("合法请求帧解析通过", () => {
    const frame = {
      type: GATEWAY_MODELS_REQUEST_FRAME_TYPE,
      id: "req-1",
      instanceIds: ["cloudflare", "blksails-ai"],
    };
    expect(GatewayModelsRequestFrameSchema.safeParse(frame).success).toBe(true);
  });

  it.each([
    ["type 不符", { type: "agent_routes", id: "r", instanceIds: ["cf"] }],
    ["id 为空串", { type: GATEWAY_MODELS_REQUEST_FRAME_TYPE, id: "", instanceIds: ["cf"] }],
    ["id 缺失", { type: GATEWAY_MODELS_REQUEST_FRAME_TYPE, instanceIds: ["cf"] }],
    // 空实例清单没有意义:发一次不问任何实例的往返只会浪费一轮,且让应答侧无从判断意图。
    ["实例清单为空", { type: GATEWAY_MODELS_REQUEST_FRAME_TYPE, id: "r", instanceIds: [] }],
    [
      "实例标识含空串",
      { type: GATEWAY_MODELS_REQUEST_FRAME_TYPE, id: "r", instanceIds: [""] },
    ],
  ])("%s → 解析失败", (_label, frame) => {
    expect(GatewayModelsRequestFrameSchema.safeParse(frame).success).toBe(false);
  });
});

describe("GatewayModelsResultFrameSchema — 宿主→runner", () => {
  it("ready 应答解析通过并保真", () => {
    const frame = {
      type: GATEWAY_MODELS_RESULT_FRAME_TYPE,
      id: "req-1",
      instances: [{ instanceId: "cloudflare", models: ["anthropic/claude-opus-5"] }],
      reason: "ready",
    };
    const parsed = GatewayModelsResultFrameSchema.safeParse(frame);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.instances[0]?.models).toEqual(["anthropic/claude-opus-5"]);
    }
  });

  // ★ 成因必须可判别(Req 4.1):三种 reason 各自合法且互不等价。
  //   「目录未就绪(timeout)」与「已就绪但收敛后为空(ready + 空数组)」在这一层就分开,
  //   合并成同一种应答会让四种成因在诊断上重新变得不可分辨。
  it.each(["ready", "timeout", "unavailable"])("reason=%s 合法", (reason) => {
    expect(
      GatewayModelsResultFrameSchema.safeParse({
        type: GATEWAY_MODELS_RESULT_FRAME_TYPE,
        id: "r",
        instances: [],
        reason,
      }).success,
    ).toBe(true);
  });

  it("ready + 空模型集是合法应答(表示收敛后确实为空,不同于 timeout)", () => {
    const parsed = GatewayModelsResultFrameSchema.safeParse({
      type: GATEWAY_MODELS_RESULT_FRAME_TYPE,
      id: "r",
      instances: [{ instanceId: "cf", models: [] }],
      reason: "ready",
    });
    expect(parsed.success).toBe(true);
  });

  it.each([
    ["未知 reason", "pending"],
    ["reason 缺失", undefined],
  ])("%s → 解析失败", (_label, reason) => {
    expect(
      GatewayModelsResultFrameSchema.safeParse({
        type: GATEWAY_MODELS_RESULT_FRAME_TYPE,
        id: "r",
        instances: [],
        ...(reason === undefined ? {} : { reason }),
      }).success,
    ).toBe(false);
  });
});

// 两个字面量是两侧共用的单一权威;写死在别处会随时间漂移。
describe("帧类型字面量与 schema 一致", () => {
  it("请求/应答的 type 字面量与各自 schema 匹配", () => {
    expect(
      GatewayModelsRequestFrameSchema.safeParse({
        type: GATEWAY_MODELS_REQUEST_FRAME_TYPE,
        id: "r",
        instanceIds: ["cf"],
      }).success,
    ).toBe(true);
    expect(
      GatewayModelsResultFrameSchema.safeParse({
        type: GATEWAY_MODELS_RESULT_FRAME_TYPE,
        id: "r",
        instances: [],
        reason: "ready",
      }).success,
    ).toBe(true);
    expect(GATEWAY_MODELS_REQUEST_FRAME_TYPE).not.toBe(GATEWAY_MODELS_RESULT_FRAME_TYPE);
  });
});

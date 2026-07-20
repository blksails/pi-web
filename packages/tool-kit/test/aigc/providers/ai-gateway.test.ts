/**
 * ai-gateway provider 单元测试(spec ai-gateway-providers,design.md §3,Req Story 5)。
 *
 * 覆盖:route 形态断言(model/provider/占位符 base+key/requiredVars/零 quirks)、
 * providerModel 区分路由键与实际发往网关的 model 名、buildBody/pickResult 复用
 * openai-compat 通用工厂(与 newapi/sufy 同构)。
 */

import { describe, it, expect } from "vitest";
import {
  createAiGatewayImage,
  createAiGatewayImageEdit,
} from "../../../src/aigc/providers/ai-gateway.js";
import type { BuildBodyContext } from "../../../src/engine/endpoint-types.js";

const ctx: BuildBodyContext = {};

describe("createAiGatewayImage — route 形态", () => {
  it("model/provider/占位符 base+key/requiredVars 正确", () => {
    const v = createAiGatewayImage({
      model: "gpt-image-1",
      label: "AI Gateway Test",
      description: "desc",
    });
    expect(v.model).toBe("gpt-image-1");
    expect(v.provider).toBe("ai-gateway");
    // base URL 走占位符(模块顶层不读 env,Req 6.2)。
    expect(v.url).toContain("${BLKSAILS_GATEWAY_BASE_URL:-http://127.0.0.1:8080}/v1");
    expect(v.url).toBe(
      "${BLKSAILS_GATEWAY_BASE_URL:-http://127.0.0.1:8080}/v1/images/generations",
    );
    expect(v.requiredVars).toContain("BLKSAILS_GATEWAY_API_KEY");
    expect(v.headers?.["authorization"]).toBe("Bearer ${BLKSAILS_GATEWAY_API_KEY}");
  });

  it("零 quirks:response_format 显式发送(不像 sufy/newapi 那样 omit)", async () => {
    const v = createAiGatewayImage({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const body = (await v.buildBody?.({ prompt: "x" }, ctx)) as Record<string, unknown>;
    expect(body.response_format).toBe("b64_json");
  });

  it("providerModel 区分路由键与实际发送 model", async () => {
    const v = createAiGatewayImage({
      model: "gpt-image-2-ai-gateway",
      label: "L",
      description: "d",
      providerModel: "gpt-image-2",
    });
    expect(v.model).toBe("gpt-image-2-ai-gateway");
    const body = (await v.buildBody?.({ prompt: "x" }, ctx)) as Record<string, unknown>;
    expect(body.model).toBe("gpt-image-2");
  });

  it("pickResult 从 data[].url 提取(单张)", () => {
    const v = createAiGatewayImage({ model: "m", label: "L", description: "d" });
    const picked = v.pickResult!({ data: [{ url: "https://example.com/out.png" }] });
    expect(picked.kind).toBe("image");
  });

  it("detectError 提取 error.message", () => {
    const v = createAiGatewayImage({ model: "m", label: "L", description: "d" });
    expect(v.detectError!({ error: { message: "quota exceeded" } })).toBe("quota exceeded");
  });

  it("extras 可覆盖 model(用于避免与其它 provider 的 LLM 可见路由键冲突)", () => {
    const v = createAiGatewayImage(
      { model: "gpt-image-2", label: "L", description: "d", providerModel: "gpt-image-2" },
      { model: "gpt-image-2-ai-gateway" },
    );
    expect(v.model).toBe("gpt-image-2-ai-gateway");
  });
});

describe("createAiGatewayImageEdit — route 形态", () => {
  it("model/provider/占位符 base+key/requiredVars 正确,url 走 /images/edits", () => {
    const v = createAiGatewayImageEdit({
      model: "gpt-image-1",
      label: "AI Gateway Edit Test",
      description: "desc",
    });
    expect(v.provider).toBe("ai-gateway");
    expect(v.url).toBe(
      "${BLKSAILS_GATEWAY_BASE_URL:-http://127.0.0.1:8080}/v1/images/edits",
    );
    expect(v.requiredVars).toContain("BLKSAILS_GATEWAY_API_KEY");
  });

  it("buildBody 返回 FormData 含 model/prompt/image", async () => {
    const v = createAiGatewayImageEdit({
      model: "gpt-image-1",
      label: "L",
      description: "d",
    });
    const dataUri = "data:image/png;base64,aGVsbG8=";
    const body = (await v.buildBody?.(
      { prompt: "add stars", image: dataUri, n: 1 },
      ctx,
    )) as FormData;
    expect(body instanceof FormData).toBe(true);
    expect(body.get("model")).toBe("gpt-image-1");
    expect(body.get("prompt")).toBe("add stars");
  });
});

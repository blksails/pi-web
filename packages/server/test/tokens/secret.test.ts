/**
 * tokens · secret 族解析单测(spec sandbox-credentials-v2,Req 1.5)。
 */
import { describe, it, expect } from "vitest";
import {
  resolveLlmGatewaySecret,
  resolveScopedTokenSecret,
  LLM_GATEWAY_SECRET_ENV,
} from "../../src/tokens/secret.js";

describe("resolveLlmGatewaySecret", () => {
  it("优先取 PI_WEB_LLM_GATEWAY_SECRET", () => {
    const env = {
      PI_WEB_LLM_GATEWAY_SECRET: "llm-secret",
      PI_WEB_ATTACHMENT_SECRET: "attach-secret",
    };
    expect(resolveLlmGatewaySecret(env)).toBe("llm-secret");
  });

  it("缺专属 env 时回退 PI_WEB_ATTACHMENT_SECRET(取值与附件一致)", () => {
    const env = { PI_WEB_ATTACHMENT_SECRET: "attach-secret" };
    expect(resolveLlmGatewaySecret(env)).toBe("attach-secret");
  });

  it("专属 env 为空串时视为缺失并回退", () => {
    const env = {
      PI_WEB_LLM_GATEWAY_SECRET: "",
      PI_WEB_ATTACHMENT_SECRET: "attach-secret",
    };
    expect(resolveLlmGatewaySecret(env)).toBe("attach-secret");
  });

  it("两者皆缺时抛清晰错误(含两个 env 名)", () => {
    expect(() => resolveLlmGatewaySecret({})).toThrowError(
      /PI_WEB_LLM_GATEWAY_SECRET.*PI_WEB_ATTACHMENT_SECRET/s,
    );
  });

  it("LLM_GATEWAY_SECRET_ENV 常量即专属 env 名", () => {
    expect(LLM_GATEWAY_SECRET_ENV).toBe("PI_WEB_LLM_GATEWAY_SECRET");
  });
});

describe("resolveScopedTokenSecret(按面参数化)", () => {
  it("faceLabel 进入错误文案便于定位服务面", () => {
    expect(() =>
      resolveScopedTokenSecret("PI_WEB_STORE_SECRET", {}, "store"),
    ).toThrowError(/\[store\]/);
  });

  it("不同面以各自专属 env 名解析,互不干扰", () => {
    const env = {
      PI_WEB_STORE_SECRET: "store-secret",
      PI_WEB_ATTACHMENT_SECRET: "attach-secret",
    };
    expect(resolveScopedTokenSecret("PI_WEB_STORE_SECRET", env, "store")).toBe(
      "store-secret",
    );
  });
});

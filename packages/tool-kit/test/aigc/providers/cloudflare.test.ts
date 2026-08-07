/**
 * Cloudflare AI Gateway provider 单元测试(spec cloudflare-aigc-provider)。
 *
 * ★ 全部夹具形态取自 2026-07-29 对账号真机 `/ai/run` 的**实际响应**(research.md §1.1),
 * 不是凭空构造的形状:
 *  - Unified 第三方(openai/gpt-image-2)→ `{result:{state:"Completed",result:{image:<R2 URL>}}}`
 *  - Workers AI 原生(@cf/…flux-1-schnell)→ `{result:{image:"<裸 base64 JPEG>"}}`
 *  - 未知模型 → `{errors:[{message:"Model not found: …",code:7003}],success:false,result:{}}`
 *
 * 覆盖:
 *  - 路由基底:url/headers 的 ${VAR} 占位、requiredVars 三项、provider 徽章
 *  - buildBody(T2I):参数嵌在 input 下而非平铺;negative_prompt 并入正文;空值不落键
 *  - buildBody(编辑):data URI → 裸 base64、键名为复数 images
 *  - ★ buildBody(编辑)无图时抛错且不产出 body —— 防 CF 静默退化为文生图的伪成功
 *  - pickResult:双形态各一;base64 分支 MIME 嗅探;两路未命中回落 raw
 *  - detectError:errors 数组含 code;success=false;state 非 Completed
 */

import { describe, it, expect } from "vitest";
import {
  createCloudflareImage,
  createCloudflareImageEdit,
  sniffImageMime,
  isCloudflareConfigured,
  CLOUDFLARE_REQUIRED_ENV,
} from "../../../src/aigc/providers/cloudflare.js";
import type { BuildBodyContext } from "../../../src/engine/endpoint-types.js";

const ctx: BuildBodyContext = {};

const ARGS = {
  model: "gpt-image-2-cf",
  label: "GPT Image 2 · Cloudflare",
  description: "d",
  providerModel: "openai/gpt-image-2",
};

/** 真机响应片段:1×1 透明 PNG 的 base64(用于 MIME 嗅探断言)。 */
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
/** JPEG magic 的 base64 前缀(真机 flux 返回即以此开头)。 */
const JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEB";

describe("createCloudflareImage 路由元数据", () => {
  it("url/headers 全走 ${VAR} 占位,requiredVars 三项齐全", () => {
    const v = createCloudflareImage(ARGS);
    expect(v.model).toBe("gpt-image-2-cf");
    expect(v.provider).toBe("cloudflare");
    expect(v.method).toBe("POST");
    expect(v.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/run",
    );
    expect(v.headers?.["authorization"]).toBe("Bearer ${CLOUDFLARE_API_TOKEN}");
    expect(v.headers?.["cf-aig-gateway-id"]).toBe("${CLOUDFLARE_AIG_GATEWAY_ID}");
    expect(v.requiredVars).toEqual([
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_AIG_GATEWAY_ID",
      "CLOUDFLARE_API_TOKEN",
    ]);
  });

  it("★ 凭据 env 名不得是 pi SDK 保留名 AI_GATEWAY_API_KEY(会劫持全部模型调用)", () => {
    const v = createCloudflareImage(ARGS);
    expect(v.requiredVars).not.toContain("AI_GATEWAY_API_KEY");
    expect(JSON.stringify(v.headers)).not.toContain("AI_GATEWAY_API_KEY");
  });

  it("extras 可覆盖路由键,providerModel 与路由键分离", async () => {
    const v = createCloudflareImage(
      { model: "a", label: "L", description: "d", providerModel: "openai/gpt-image-2" },
      { model: "a-cf" },
    );
    expect(v.model).toBe("a-cf");
    const body = (await v.buildBody?.({ prompt: "x" }, ctx)) as { model: string };
    // 发往 CF 的仍是 providerModel,不受路由键覆盖影响。
    expect(body.model).toBe("openai/gpt-image-2");
  });

  it("providerModel 省略 → 用路由键作为发送 model", async () => {
    const v = createCloudflareImage({ model: "@cf/x/y", label: "L", description: "d" });
    const body = (await v.buildBody?.({ prompt: "x" }, ctx)) as { model: string };
    expect(body.model).toBe("@cf/x/y");
  });
});

describe("buildBody — 文生图", () => {
  it("参数嵌在 input 下(非平铺),这是与 OpenAI /images 的关键差异", async () => {
    const v = createCloudflareImage(ARGS);
    const body = (await v.buildBody?.(
      { prompt: "a fox", size: "1024x1536", quality: "low", output_format: "jpeg", n: 1 },
      ctx,
    )) as { model: string; input: Record<string, unknown> };

    expect(body.model).toBe("openai/gpt-image-2");
    expect(body.input).toEqual({
      prompt: "a fox",
      size: "1024x1536",
      quality: "low",
      output_format: "jpeg",
      n: 1,
    });
    // 反向断言:参数没有平铺在顶层。
    expect(body).not.toHaveProperty("prompt");
    expect(body).not.toHaveProperty("size");
  });

  it("未给的可选参数不落键(不向 CF 发 undefined)", async () => {
    const v = createCloudflareImage(ARGS);
    const body = (await v.buildBody?.({ prompt: "x" }, ctx)) as { input: Record<string, unknown> };
    expect(Object.keys(body.input)).toEqual(["prompt"]);
  });

  it("negative_prompt 并入正文(CF 无原生字段)", async () => {
    const v = createCloudflareImage(ARGS);
    const body = (await v.buildBody?.(
      { prompt: "a fox", negative_prompt: "blurry" },
      ctx,
    )) as { input: { prompt: string } };
    expect(body.input.prompt).toBe("a fox\n\nAvoid: blurry");
  });
});

describe("buildBody — 图像编辑", () => {
  it("data URI 转成裸 base64,键名为复数 images", async () => {
    const v = createCloudflareImageEdit(ARGS);
    const body = (await v.buildBody?.(
      { prompt: "make it red", images: [`data:image/png;base64,${PNG_B64}`] },
      ctx,
    )) as { input: { images: string[] } };

    expect(body.input.images).toEqual([PNG_B64]);
    // 裸 base64 —— 不带 data: 前缀。
    expect(body.input.images[0]).not.toMatch(/^data:/);
    // ★ 单数 image 会被 CF 静默忽略,必须是复数键。
    expect(body.input).not.toHaveProperty("image");
  });

  it("images 数组按顺序透传(首项主图、其余参考图)", async () => {
    const v = createCloudflareImageEdit(ARGS);
    const body = (await v.buildBody?.(
      {
        prompt: "p",
        images: [`data:image/png;base64,${PNG_B64}`, `data:image/jpeg;base64,${JPEG_B64}`],
      },
      ctx,
    )) as { input: { images: string[] } };
    expect(body.input.images).toEqual([PNG_B64, JPEG_B64]);
  });

  it("★ 数组中夹杂无法解析的项时跳过该项,其余仍提交(有图即不拦截)", async () => {
    const v = createCloudflareImageEdit(ARGS);
    const body = (await v.buildBody?.(
      {
        prompt: "p",
        images: ["https://example.com/a.png", `data:image/jpeg;base64,${JPEG_B64}`],
      },
      ctx,
    )) as { input: { images: string[] } };
    expect(body.input.images).toEqual([JPEG_B64]);
  });

  it("★ images 缺省时抛错且不产出 body(防 CF 静默退化为文生图的伪成功)", async () => {
    const v = createCloudflareImageEdit(ARGS);
    await expect(v.buildBody?.({ prompt: "make it red" }, ctx)).rejects.toThrow(/至少一张参考图/);
  });

  it("★ images 为空数组时同样抛错", async () => {
    const v = createCloudflareImageEdit(ARGS);
    await expect(v.buildBody?.({ prompt: "p", images: [] }, ctx)).rejects.toThrow(/至少一张参考图/);
  });

  it("★ images 全是非 data URI(如 https 直链)时同样抛错,不静默降级", async () => {
    const v = createCloudflareImageEdit(ARGS);
    await expect(
      v.buildBody?.({ prompt: "p", images: ["https://example.com/a.png"] }, ctx),
    ).rejects.toThrow(/至少一张参考图/);
  });

  it("mask 插入 images 第 2 位(主图 → mask → 参考图),并改写 prompt 点明遮罩", async () => {
    const v = createCloudflareImageEdit(ARGS);
    const MASK_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5W2n0AAAAASUVORK5CYII=";
    const body = (await v.buildBody?.(
      {
        prompt: "add a hat",
        images: [
          `data:image/png;base64,${PNG_B64}`,
          `data:image/jpeg;base64,${JPEG_B64}`,
        ],
        mask: `data:image/png;base64,${MASK_B64}`,
      },
      ctx,
    )) as { input: { images: string[]; prompt: string } };

    expect(body.input.images).toEqual([PNG_B64, MASK_B64, JPEG_B64]);
    expect(body.input.prompt).toMatch(/second image is a mask/i);
    expect(body.input.prompt).toContain("add a hat");
    // 无独立 mask 键(CF 协议只有 images)
    expect(body.input).not.toHaveProperty("mask");
  });

  it("无 mask 时 images 顺序与 prompt 保持原样", async () => {
    const v = createCloudflareImageEdit(ARGS);
    const body = (await v.buildBody?.(
      {
        prompt: "make it blue",
        images: [`data:image/png;base64,${PNG_B64}`],
      },
      ctx,
    )) as { input: { images: string[]; prompt: string } };
    expect(body.input.images).toEqual([PNG_B64]);
    expect(body.input.prompt).toBe("make it blue");
  });

  it("mask 无法解析时跳过,不插入、不改 prompt", async () => {
    const v = createCloudflareImageEdit(ARGS);
    const body = (await v.buildBody?.(
      {
        prompt: "p",
        images: [`data:image/png;base64,${PNG_B64}`],
        mask: "https://example.com/mask.png",
      },
      ctx,
    )) as { input: { images: string[]; prompt: string } };
    expect(body.input.images).toEqual([PNG_B64]);
    expect(body.input.prompt).toBe("p");
  });
});

describe("pickResult — 双响应形态(Req 3)", () => {
  it("Unified 第三方:result.result.image 为远程 URL,原样透出", () => {
    const v = createCloudflareImage(ARGS);
    const picked = v.pickResult?.({
      result: {
        state: "Completed",
        result: { image: "https://ai-gateway-outputs.example.r2.cloudflarestorage.com/x?sig=y" },
        gatewayMetadata: { keySource: "Unified" },
      },
      success: true,
      errors: [],
    });
    expect(picked).toEqual({
      kind: "image",
      url: "https://ai-gateway-outputs.example.r2.cloudflarestorage.com/x?sig=y",
    });
  });

  it("Workers AI 原生:result.image 为裸 base64 → 拼成 data URI(JPEG 嗅探)", () => {
    const v = createCloudflareImage(ARGS);
    const picked = v.pickResult?.({ result: { image: JPEG_B64 }, success: true });
    expect(picked).toEqual({ kind: "image", url: `data:image/jpeg;base64,${JPEG_B64}` });
  });

  it("Workers AI 原生:PNG 嗅探", () => {
    const v = createCloudflareImage(ARGS);
    const picked = v.pickResult?.({ result: { image: PNG_B64 }, success: true });
    expect(picked).toEqual({ kind: "image", url: `data:image/png;base64,${PNG_B64}` });
  });

  it("已是 data URI 时不双重拼接", () => {
    const v = createCloudflareImage(ARGS);
    const picked = v.pickResult?.({ result: { image: `data:image/png;base64,${PNG_B64}` } });
    expect(picked).toEqual({ kind: "image", url: `data:image/png;base64,${PNG_B64}` });
  });

  it("两条取图路径均未命中 → raw(由上层判失败,Req 6.3)", () => {
    const v = createCloudflareImage(ARGS);
    expect(v.pickResult?.({ result: {}, success: true })).toEqual({
      kind: "raw",
      value: { result: {}, success: true },
    });
    expect(v.pickResult?.({})).toEqual({ kind: "raw", value: {} });
  });

  it("Unified 优先于 Workers AI 分支(两者同时存在时取嵌套的)", () => {
    const v = createCloudflareImage(ARGS);
    const picked = v.pickResult?.({
      result: { result: { image: "https://x/y" }, image: JPEG_B64 },
    });
    expect(picked).toEqual({ kind: "image", url: "https://x/y" });
  });
});

describe("detectError", () => {
  it("errors 数组 → 含 message 与 code 的可读描述(真机 404 形态)", () => {
    const v = createCloudflareImage(ARGS);
    const err = v.detectError?.({
      errors: [{ message: "Model not found: openai/no-such-model-xyz", code: 7003 }],
      success: false,
      result: {},
    });
    expect(err).toContain("Model not found: openai/no-such-model-xyz");
    // code 用于区分「模型不存在」与「凭据无效」(Req 6.2)。
    expect(err).toContain("7003");
  });

  it("success=false 但无 errors → 仍判失败", () => {
    const v = createCloudflareImage(ARGS);
    expect(v.detectError?.({ success: false })).toBeTruthy();
  });

  it("state 非 Completed → 判失败", () => {
    const v = createCloudflareImage(ARGS);
    expect(v.detectError?.({ result: { state: "Failed" }, success: true })).toContain("Failed");
  });

  it("正常响应 → 无错", () => {
    const v = createCloudflareImage(ARGS);
    expect(
      v.detectError?.({
        result: { state: "Completed", result: { image: "https://x" } },
        success: true,
        errors: [],
      }),
    ).toBeUndefined();
  });
});

describe("sniffImageMime", () => {
  it.each([
    [JPEG_B64, "image/jpeg"],
    [PNG_B64, "image/png"],
    ["R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "image/gif"],
    ["UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "image/webp"],
    ["Zm9vYmFy", "image/png"], // 无法判定 → png 兜底
  ])("嗅探 %s… → %s", (b64, mime) => {
    expect(sniffImageMime(b64)).toBe(mime);
  });
});

/**
 * 启用判据的单一事实源(spec cloudflare-aigc-provider)。
 *
 * ★ 这组用例源于一个真机暴露的缺口:工具侧(aigcExtension)与宿主侧(/aigc/models 目录
 * 装配)各自决定是否提供 Cloudflare 模型。两处判据若分别手写,漂移时会出现「设置页列得出
 * 模型但工具里选不到」或反之的错位 —— 故统一走 isCloudflareConfigured。
 */
describe("isCloudflareConfigured — 启用判据", () => {
  const FULL = {
    CLOUDFLARE_ACCOUNT_ID: "a",
    CLOUDFLARE_AIG_GATEWAY_ID: "g",
    CLOUDFLARE_API_TOKEN: "t",
  };

  it("三项齐备 → true", () => {
    expect(isCloudflareConfigured(FULL)).toBe(true);
  });

  it("缺任意一项 → false", () => {
    for (const k of Object.keys(FULL)) {
      const partial = { ...FULL };
      delete (partial as Record<string, string | undefined>)[k];
      expect(isCloudflareConfigured(partial), `缺 ${k} 应为 false`).toBe(false);
    }
  });

  it("空串 / 纯空白 → false", () => {
    expect(isCloudflareConfigured({ ...FULL, CLOUDFLARE_API_TOKEN: "" })).toBe(false);
    expect(isCloudflareConfigured({ ...FULL, CLOUDFLARE_API_TOKEN: "   " })).toBe(false);
  });

  it("空 env / 不传参 → false(默认不启用)", () => {
    expect(isCloudflareConfigured({})).toBe(false);
    expect(isCloudflareConfigured()).toBe(false);
  });

  it("★ CLOUDFLARE_REQUIRED_ENV 与路由的 requiredVars 是同一组名字(防两处漂移)", () => {
    const route = createCloudflareImage(ARGS);
    expect([...CLOUDFLARE_REQUIRED_ENV].sort()).toEqual([...(route.requiredVars ?? [])].sort());
  });
});

/**
 * 出站代理声明(2026-07-29 真机暴露)。
 *
 * ★ 背景:`api.cloudflare.com` 与产出图所在的 `*.r2.cloudflarestorage.com` 在部分网络下
 * 直连超时(`connect ETIMEDOUT 172.64.66.1:443`)。curl 能通而应用失败,是因为 curl 读
 * `HTTPS_PROXY` 而 node 的 undici fetch 默认不读 —— 必须由路由显式声明 proxy 占位符。
 */
describe("出站代理", () => {
  it("两个工厂都声明 ${CLOUDFLARE_PROXY} 占位符", () => {
    expect(createCloudflareImage(ARGS).proxy).toBe("${CLOUDFLARE_PROXY}");
    expect(createCloudflareImageEdit(ARGS).proxy).toBe("${CLOUDFLARE_PROXY}");
  });

  it("★ 代理不进 requiredVars —— 否则未配代理的环境会整体拿不到该 provider", () => {
    const route = createCloudflareImage(ARGS);
    expect(route.requiredVars).not.toContain("CLOUDFLARE_PROXY");
    expect(isCloudflareConfigured({
      CLOUDFLARE_ACCOUNT_ID: "a",
      CLOUDFLARE_AIG_GATEWAY_ID: "g",
      CLOUDFLARE_API_TOKEN: "t",
    })).toBe(true);
  });
});

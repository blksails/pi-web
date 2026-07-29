/**
 * Cloudflare provider **真机**验收(spec cloudflare-aigc-provider 任务 5.2/5.3)。
 *
 * ★ 刻意**不用 curl 复现**:本套件经 `createCloudflareImage` / `createCloudflareImageEdit`
 * 产出 ImageRoute,再交给真正的执行层 `runEndpoint` 发起调用 —— 走的是本特性的完整代码
 * 路径(`${VAR}` 占位符解析、buildBody、pickResult、detectError 全部参与)。curl 只能证明
 * 「CF 接口可用」,只有这样才能证明「本特性可用」。
 *
 * 默认 **skip**:仅当三个 `CLOUDFLARE_*` env 齐备时才运行,故 `pnpm test` 不受影响、CI 不会
 * 因缺凭据而红。手动跑:
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_AIG_GATEWAY_ID=… CLOUDFLARE_API_TOKEN=… \
 *   npx vitest run test/aigc/providers/cloudflare.live.test.ts
 *
 * 产出图落在 `CF_LIVE_OUT`(默认 /tmp/cf-live),供人工核验。
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  createCloudflareImage,
  createCloudflareImageEdit,
} from "../../../src/aigc/providers/cloudflare.js";
import { CLOUDFLARE_IMAGE_ROUTES } from "../../../src/aigc/tools/image-generation.js";
import { runEndpoint } from "../../../src/engine/endpoint-adapter.js";
import { proxyFetch } from "../../../src/engine/proxy-fetch.js";
import type { PickedResult } from "../../../src/engine/endpoint-types.js";

const HAS_CREDS = ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_AIG_GATEWAY_ID", "CLOUDFLARE_API_TOKEN"].every(
  (k) => (process.env[k] ?? "").trim().length > 0,
);

const OUT = process.env.CF_LIVE_OUT ?? "/tmp/cf-live";
const TIMEOUT = 180_000;

const GEN_ARGS = {
  model: "gpt-image-2-cf",
  label: "GPT Image 2 · Cloudflare",
  description: "d",
  providerModel: "openai/gpt-image-2",
};

/** 把 PickedResult 落盘并返回可断言的元数据。 */
async function persist(
  picked: PickedResult,
  name: string,
): Promise<{ bytes: number; where: string; via: "data-uri" | "remote-url"; mime?: string }> {
  if (picked.kind !== "image") {
    throw new Error(`期望 kind=image,实得 ${picked.kind}: ${JSON.stringify(picked).slice(0, 300)}`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  const url = picked.url;
  if (url.startsWith("data:")) {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(url);
    if (!m) throw new Error("data URI 解析失败");
    const ext = (m[1] as string).split("/")[1];
    const file = path.join(OUT, `${name}.${ext}`);
    fs.writeFileSync(file, Buffer.from(m[2] as string, "base64"));
    return { bytes: fs.statSync(file).size, where: file, via: "data-uri", mime: m[1] };
  }
  // ★ 必须经 proxyFetch 而非裸 fetch:产出图在 *.r2.cloudflarestorage.com,该域在部分网络下
  // 直连超时。provider 请求侧已由 behavior.proxy 走代理,下载侧若用裸 fetch 就会「请求成功、
  // 取图失败」——表现为 `fetch failed`,极易误判成响应格式不匹配。
  const res = await proxyFetch(url, undefined, process.env.CLOUDFLARE_PROXY);
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(OUT, `${name}.img`);
  fs.writeFileSync(file, buf);
  return { bytes: buf.length, where: file, via: "remote-url" };
}

describe.skipIf(!HAS_CREDS)("Cloudflare 真机 — 文生图(Req 1.1/1.2/1.3/1.5)", () => {
  it(
    "中文 prompt 出图,size/quality/output_format 生效",
    async () => {
      const route = createCloudflareImage(GEN_ARGS);
      const picked = await runEndpoint(route, {
        prompt: "一只戴着圆框眼镜的橘猫在图书馆看书,水彩风格",
        size: "1024x1536",
        quality: "low",
        output_format: "jpeg",
      });
      const info = await persist(picked, "t2i");
      console.log("[live] t2i →", info);

      expect(picked.kind).toBe("image");
      // Unified 第三方模型返回远程 R2 URL(非 base64)。
      expect(info.via).toBe("remote-url");
      expect(info.bytes).toBeGreaterThan(10_000);
      // quality=low + jpeg 应显著小于默认 png(实测 236KB vs 1.5MB)。
      expect(info.bytes).toBeLessThan(800_000);
      // JPEG magic:FF D8 FF。
      const head = fs.readFileSync(info.where).subarray(0, 3);
      expect([...head]).toEqual([0xff, 0xd8, 0xff]);
    },
    TIMEOUT,
  );
});

describe.skipIf(!HAS_CREDS)("Cloudflare 真机 — 图像编辑(Req 2.1/2.3)", () => {
  it(
    "参考图经 input.images 提交,产出图保持原图并按指令修改",
    async () => {
      // 先生成一张源图(而非依赖外部素材),使本用例自包含。
      const genRoute = createCloudflareImage(GEN_ARGS);
      const src = await runEndpoint(genRoute, {
        prompt: "一只橘猫坐在蓝色沙发上,正面,简洁插画风格",
        size: "1024x1024",
        quality: "low",
        output_format: "jpeg",
      });
      const srcInfo = await persist(src, "edit-source");
      const b64 = fs.readFileSync(srcInfo.where).toString("base64");

      const editRoute = createCloudflareImageEdit(GEN_ARGS);
      const picked = await runEndpoint(editRoute, {
        prompt: "把沙发的颜色改成鲜红色,猫和构图保持完全不变",
        // 入参契约:单一 images 数组,首项 = 待编辑主图(2026-07-29 统一)。
        images: [`data:image/jpeg;base64,${b64}`],
        size: "1024x1024",
        quality: "low",
        output_format: "jpeg",
      });
      const info = await persist(picked, "edit-result");
      console.log("[live] edit source →", srcInfo);
      console.log("[live] edit result →", info);

      expect(picked.kind).toBe("image");
      expect(info.bytes).toBeGreaterThan(10_000);
    },
    TIMEOUT * 2,
  );

  it(
    "★ 参考图解析不出时抛错且不发请求(不静默退化为文生图)",
    async () => {
      const route = createCloudflareImageEdit(GEN_ARGS);
      // 非 data URI:模拟编排层未能解析出图像数据的情形。
      await expect(
        runEndpoint(route, {
          prompt: "把沙发改成红色",
          images: ["https://example.invalid/not-resolved.jpg"],
        }),
      ).rejects.toThrow(/至少一张参考图/);
    },
    TIMEOUT,
  );
});

describe.skipIf(!HAS_CREDS)("Cloudflare 真机 — 目录内全部模型可出图(Req 4.5)", () => {
  // ★ 直打 /ai/run 的探针只能证明「CF 接口可用」;此处逐个经**本特性代码路径**
  // (工厂 → runEndpoint → pickResult)复验,才能证明目录里每一条都真的能用。
  const catalog = CLOUDFLARE_IMAGE_ROUTES;

  it.each(catalog.map((r) => [r.model, r] as const))(
    "%s 经本特性代码路径可出图",
    async (name, route) => {
      const picked = await runEndpoint(route, { prompt: "a red apple on a white table" });
      const info = await persist(picked, `catalog-${name}`);
      console.log(`[live] ${name} →`, info);
      expect(picked.kind).toBe("image");
      expect(info.bytes).toBeGreaterThan(1_000);
    },
    TIMEOUT,
  );
});

/**
 * Workers AI 原生形态(Req 3.2/3.3)——**默认 skip**,需 `CF_TEST_WORKERS_AI=1` 显式开启。
 *
 * 这类模型不走 Unified 统一计费,吃账号每日 10,000 neurons 免费额度,耗尽后恒 429
 * (`code 4006`)。若无条件跑,本用例会在额度用完后变成常红噪声,掩盖真实回归。
 * 对应的模型也已从目录摘出(见 CLOUDFLARE_WORKERS_AI_ROUTES),故这里改为按需验证。
 *
 * ★ base64 分支的**离线**保障不受影响:`cloudflare.test.ts` 的 pickResult 单测仍覆盖
 * 裸 base64 → MIME 嗅探 → data URI 的完整逻辑。
 */
describe.skipIf(!HAS_CREDS || process.env.CF_TEST_WORKERS_AI !== "1")(
  "Cloudflare 真机 — Workers AI 原生形态(Req 3.2/3.3)",
  () => {
  it(
    "@cf/* 模型返回裸 base64,经 MIME 嗅探拼成 data URI 后可正常落盘",
    async () => {
      const route = createCloudflareImage({
        model: "flux-1-schnell-cf",
        label: "FLUX.1 schnell · Cloudflare",
        description: "d",
        providerModel: "@cf/black-forest-labs/flux-1-schnell",
      });
      const picked = await runEndpoint(route, {
        prompt: "a blue geometric cube on a white background",
      });
      const info = await persist(picked, "workers-ai");
      console.log("[live] workers-ai →", info);

      expect(picked.kind).toBe("image");
      // ★ 与 Unified 分支的关键差异:这里走的是 base64 → data URI 路径。
      expect(info.via).toBe("data-uri");
      expect(info.mime).toMatch(/^image\//);
      expect(info.bytes).toBeGreaterThan(1_000);
    },
    TIMEOUT,
  );
  },
);

/**
 * 存量图像模型启停设置零迁移回归闸门(spec: multi-gateway-providers,任务 7.1;Req 9.2)。
 *
 * `aigc.json` 的 `disabledModels` 存**裸 model id**(目录 `model` 字段值,不带 provider
 * 前缀,research.md §4.7 实测)。目录条目字段改名(`model`→`id`、`label`→`name`)不影响
 * 该字段存的值——本用例走真实消费路径(`resolveAigcToolSettings` 读盘 +
 * `deriveActiveModels` 按真实路由表过滤),而非手写 stub 喂期望值,断言被禁模型确实
 * 从活跃清单里消失、未禁的仍在。
 *
 * ★ 用例选的是 `IMAGE_GENERATION_ROUTES`/`IMAGE_EDIT_ROUTES` **无条件注册**的静态模型
 *   id(如 `gpt-image-2`),不是只在装配层显式传 `extraRoutes` 时才出现的
 *   `AI_GATEWAY_IMAGE_ROUTES` 条目(如 `gpt-image-1`)—— 后者在本用例默认的
 *   `extraRoutes: []` 下无论禁不禁都不出现,选它们会让"被禁后消失"这条断言零判别力。
 *
 * Req 9.1(默认 provider/模型)与 Req 9.3(视觉偏好复合键)见
 * `packages/adapters/test/ai-gateway/legacy-config-compat.it.test.ts`——那两条需要真实
 * `resolveGatewayInstances`,与本文件的图像工具设置消费路径无关,不属于本文件边界。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveAigcToolSettings } from "../../src/aigc/model-config.js";
import { deriveActiveModels } from "../../src/aigc/active-models.js";

let tmpDir: string;

beforeEach(async () => {
  tmpDir = join(tmpdir(), `aigc-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("Req 9.2 — 图像模型启停:改造前存的裸 model id 经真实消费路径原样生效(零迁移)", () => {
  // ★ 选用 "gpt-image-2" / "wan2.7-image-pro":两者都在 IMAGE_GENERATION_ROUTES /
  //   IMAGE_EDIT_ROUTES **无条件注册**的静态路由里(`extraRoutes` 缺省 `[]` 时也一定
  //   存在)。刻意不选 `AI_GATEWAY_IMAGE_ROUTES` 里的 "gpt-image-1"/"qwen-image" ——
  //   那些只在装配层显式传入 `extraRoutes` 时才会出现,本用例不传 `extraRoutes`,
  //   选它们会让"被禁后消失"这条断言在有没有归一逻辑的情况下都成立(零判别力,
  //   即便不接 `disabledModels` 它们也从不出现在 active 清单里)。
  it("resolveAigcToolSettings + deriveActiveModels:裸 id 命中真实路由表,活跃清单里对应模型消失,未禁的仍在", async () => {
    // 改造前的 aigc.json:disabledModels 存裸 model id(不带 provider 前缀)。
    await fs.writeFile(
      join(tmpDir, "aigc.json"),
      JSON.stringify({ disabledModels: ["gpt-image-2", "wan2.7-image-pro"] }),
    );

    const settings = resolveAigcToolSettings(tmpDir);
    expect(settings.disabledModels).toEqual(new Set(["gpt-image-2", "wan2.7-image-pro"]));

    const active = deriveActiveModels(settings.disabledModels);
    const activeModelIds = new Set(active.map((m) => m.model));

    expect(activeModelIds.has("gpt-image-2")).toBe(false);
    expect(activeModelIds.has("wan2.7-image-pro")).toBe(false);
    // 未禁用的模型仍在(证明不是全灭 —— 裸 id 只精确命中它自己那一条真实路由)。
    expect(activeModelIds.has("gemini-3.1-flash-image-newapi")).toBe(true);
  });

  it("★ 判别力:把存量值误当成 provider 前缀形态(如 'ai-gateway/gpt-image-2')不再命中任何真实路由的裸 id,证明本用例确实在检验「裸 id」语义", async () => {
    await fs.writeFile(
      join(tmpDir, "aigc.json"),
      JSON.stringify({ disabledModels: ["ai-gateway/gpt-image-2"] }),
    );

    const settings = resolveAigcToolSettings(tmpDir);
    const active = deriveActiveModels(settings.disabledModels);
    const activeModelIds = new Set(active.map((m) => m.model));

    // 前缀形式不命中任何真实路由的裸 id,gpt-image-2 依旧活跃。
    expect(activeModelIds.has("gpt-image-2")).toBe(true);
  });
});

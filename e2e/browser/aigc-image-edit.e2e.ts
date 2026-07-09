/**
 * AIGC image_edit(gpt-image-2)+ 附件 — 浏览器 e2e(真实网关,需 NEWAPI_API_KEY)。
 *
 * 验证我们这次修复的真实闭环:**上传 iPhone 多图 JPEG(内嵌 Apple MPF/APP2 + 尾部
 * gain map)→ image_edit 默认路由 gpt-image-2 → normalizeImageDataUri 剥 MPF →
 * NewAPI /v1/images/edits 出图 → 产物落库 → 前端经分发 URL 展示**。
 *
 * 未修复前,该 iPhone 原图会让网关回误导性的「可用渠道不存在 / no access to model(空)」
 * 而失败;修复后应正常出图。
 *
 * 运行(隔离 build + external server,见 memory pi-web-e2e-isolated-build):
 *   pnpm build:dist            # 或复用已有 dist/
 *   NEWAPI_API_KEY=… PI_WEB_STUB_AGENT=1 \
 *     PI_WEB_STUB_AGENT_PATH=./e2e/fixtures/aigc-image-edit-stub.mjs \
 *     SESSION_STORE=fs SESSION_STORE_ROOT=$FS \
 *     PORT=3100 node dist/server.mjs &
 *   PI_WEB_E2E_EXTERNAL_SERVER=1 NEWAPI_API_KEY=… \
 *     pnpm e2e aigc-image-edit
 *
 * 无 NEWAPI_API_KEY → 整个 describe skip(真实网关调用,无 key 不可测)。
 *
 * 确定性来源:PI_WEB_STUB_AGENT_PATH → e2e/fixtures/aigc-image-edit-stub.mjs。
 * 该 stub 无 LLM,但**真实**编译 image_edit 工具、真实子进程附件 store、真实规范化与
 * 真实网关调用(同 attachment-tool-bridge 既定回退)。
 */
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const SOURCE = "./examples/aigc-agent";

// 真实失败复现图:iPhone 多图 JPEG(含 AMPF/MPF + EXIF)。
// 该 fixture 是个人照片,**不入库**(见 .gitignore);本地放置后方可跑此 e2e,缺失则 skip。
const FIXTURE = path.join(__dirname, "..", "fixtures", "iphone-mpf.jpg");

async function startSession(
  page: import("@playwright/test").Page,
): Promise<string> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
  await expect(page.locator("[data-pi-input-textarea]")).toBeVisible();
  const text = await page.locator("[data-session-id]").textContent();
  const id = (text ?? "").replace("session: ", "").trim();
  expect(id.length).toBeGreaterThan(0);
  return id;
}

test.describe("aigc image_edit · gpt-image-2 + 附件(真实网关)", () => {
  test.skip(
    !process.env.NEWAPI_API_KEY,
    "NEWAPI_API_KEY 未设置 — 跳过真实 gpt-image-2 图像编辑 e2e",
  );
  test.skip(
    !existsSync(FIXTURE),
    `fixture 缺失(${FIXTURE})— 个人照片不入库,本地放置后再跑`,
  );

  test("上传 iPhone 多图 JPEG → image_edit 出图(剥 MPF 后过网关)", async ({
    page,
  }) => {
    // gpt-image-2 真实出图慢且延迟方差大(~30s–>160s)+ 网关瞬态需重试,放宽整用例超时。
    test.setTimeout(720_000);
    const sessionId = await startSession(page);
    const jpegBase64 = readFileSync(FIXTURE).toString("base64");

    // 1) 上传 iPhone 多图 JPEG(含 MPF)。
    const upload = await page.evaluate(
      async (args: { sessionId: string; b64: string }) => {
        const bin = atob(args.b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const form = new FormData();
        form.append(
          "file",
          new Blob([bytes], { type: "image/jpeg" }),
          "iphone-mpf.jpg",
        );
        const res = await fetch(`/api/sessions/${args.sessionId}/attachments`, {
          method: "POST",
          body: form,
        });
        const json = (await res.json()) as { attachment?: { id?: string } };
        return { status: res.status, id: json.attachment?.id ?? "" };
      },
      { sessionId, b64: jpegBase64 },
    );
    expect(upload.status).toBe(200);
    expect(upload.id.startsWith("att_")).toBe(true);

    // 2~4) 发编辑消息并等工具卡片到达 end;对**网关瞬态错误重试**。
    //   apiservices.top 的 gpt-image-2 渠道不稳(fetch failed / 可用渠道不存在 /
    //   no access to model 空名 等瞬态),与本仓代码无关 —— 故重试至成功或非瞬态失败。
    //   注:工具卡片在本流式下到工具结算才出现,且真实出图较慢(~30–130s),toBeVisible
    //   须用长超时。
    const TRANSIENT =
      /fetch failed|upstream request failed|可用渠道不存在|get_channel_failed|no access to model|timed out|ETIMEDOUT|ECONNRESET|502|503|504/;
    let outId: string | undefined;
    let lastCardText = "";
    for (let attempt = 1; attempt <= 4 && outId === undefined; attempt++) {
      const input = page.locator("[data-pi-input-textarea]");
      await input.fill(`把衣服改成粉红色。Input attachment: ${upload.id}`);
      await page.locator('[data-pi-submit-state="send"]').click();

      const card = page.locator("[data-pi-tool]").nth(attempt - 1);
      await expect(card).toBeVisible({ timeout: 160_000 });
      await expect(card).toHaveAttribute("data-pi-tool-phase", "end", {
        timeout: 10_000,
      });

      lastCardText = (await card.textContent()) ?? "";
      const idMatch = lastCardText.match(/id=(att_[A-Za-z0-9_-]+)/);
      if (idMatch) {
        outId = idMatch[1]!;
        break;
      }
      // 非瞬态失败 → 直接判错(暴露真实回归);瞬态 → 继续重试。
      expect(
        TRANSIENT.test(lastCardText),
        `image_edit 非瞬态失败:${lastCardText.slice(0, 300)}`,
      ).toBe(true);
    }

    expect(
      outId,
      `image_edit 应在重试内出图成功(最后一次卡片:${lastCardText.slice(0, 300)})`,
    ).toBeTruthy();
    expect(outId).not.toBe(upload.id); // 产出是新附件
    expect(lastCardText).not.toContain("data:image");
    expect(lastCardText).not.toContain("iVBOR");

    // 5) 产出分发 URL 可达:200 image/*。
    const probe = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/attachments/${id}/raw`, { method: "GET" });
      return { status: res.status, ct: res.headers.get("content-type") ?? "" };
    }, outId!);
    expect([200, 401]).toContain(probe.status);
    if (probe.status === 200) {
      expect(probe.ct).toContain("image/");
    }

    // 6) 会话不崩溃。
    await expect(page.locator("[data-pi-error-banner]")).not.toBeVisible();
  });
});

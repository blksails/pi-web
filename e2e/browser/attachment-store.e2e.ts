import { test, expect } from "@playwright/test";

/**
 * attachment-store browser e2e — 添加附件 → 上传落库 → 以分发 URL 展示 全链路。
 *
 * Full closed loop against the REAL pi-web server with the deterministic offline
 * stub agent (PI_WEB_STUB_AGENT=1), in the isolated e2e build (PI_WEB_DIST_DIR=
 * dist/) + external-server mode (does not clobber a running dev server's
 * .next). Upload (POST /api/sessions/:id/attachments) is agent-independent; the
 * stub only creates the session and surfaces the chat UI.
 *
 * Covers (requirements.md):
 *  - 5.1 — 添加附件先上传到会话上传端点,拿正式公开 id(uploading → ready)。
 *  - 5.2 — 落库后缩略图以**网络分发 URL** 展示(非 `data:` base64)。
 *  - 8.2 — 覆盖「添加→上传落库→以分发 URL 展示」的完整浏览器链路。
 *  - 8.3 — 在隔离构建产物(dist/)下运行,不污染开发态。
 *
 * 断言重点(design.md 行 498 / task 6.1):缩略图 `<img src>` 指向分发端点
 * `/attachments/.../raw`(非 `data:`),且对该 URL 的网络响应 **200**。
 */

const SOURCE = "./examples/hello-agent";

/** 一个微型有效的 1x1 透明 PNG(避免依赖磁盘 fixture)。 */
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC";

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

test("attachment: 添加 → 上传落库(uploading→ready)→ 以分发 URL 展示且 /raw 200 (Req 5.1/5.2/8.2/8.3)", async ({
  page,
}) => {
  await startSession(page);

  const pngBuffer = Buffer.from(PNG_BASE64, "base64");

  // 添加一张图片附件:经隐藏 file input(dropzone)注入,触发 useAttachments.add
  // → 本地预览 uploading 态 → 异步上传到 POST /api/sessions/:id/attachments。
  await page.locator("[data-pi-attachments-input]").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: pngBuffer,
  });

  // Req 5.1 — 该附件成为一个 chip,先经历「上传中」可感知态。
  const chip = page.locator("[data-pi-attachment-chip]").first();
  await expect(chip).toBeVisible();
  // 上传中标记(StatusOverlay status="uploading")应当出现过——以其最终消失证明态机推进。
  // (上传极快时可能瞬态,故不强制断言其可见,而断言它最终不再 uploading。)
  await expect(
    chip.locator('[data-pi-attachment-status="uploading"]'),
  ).toHaveCount(0, { timeout: 15_000 });
  // 落库失败时会出现 error 标记;断言其不存在以确保走的是 ready 路径。
  await expect(
    chip.locator('[data-pi-attachment-status="error"]'),
  ).toHaveCount(0);

  // Req 5.2 — 落库后缩略图以**网络分发 URL** 作为图片源(非内联 base64)。
  const thumb = chip.locator("[data-pi-attachment-thumb] img").first();
  await expect(thumb).toBeVisible();

  // src 收敛到分发端点 URL(非 data:),并指向 `/attachments/.../raw`。
  await expect
    .poll(
      async () => (await thumb.getAttribute("src")) ?? "",
      { timeout: 15_000, message: "等待缩略图 src 由本地 dataUrl 切换为分发 URL" },
    )
    .not.toMatch(/^data:/);

  const src = (await thumb.getAttribute("src")) ?? "";
  // 不是内联 base64(Req 5.2)。
  expect(src.startsWith("data:")).toBe(false);
  // 指向分发端点 `/attachments/:id/raw`(design.md 行 498)。
  expect(src).toMatch(/\/attachments\/[^/]+\/raw(\?|$)/);

  // 该 URL 的网络响应为 200(在页面上下文 fetch,relative URL 按 <img> 同样的源解析)。
  const probe = await page.evaluate(async (url: string) => {
    const res = await fetch(url, { method: "GET" });
    const ct = res.headers.get("content-type");
    return { status: res.status, contentType: ct };
  }, src);
  expect(probe.status).toBe(200);
  // 以正确 mime 返回字节(分发端点 Content-Type=附件 mime)。
  expect(probe.contentType ?? "").toContain("image/");

  // 浏览器实际加载该 <img> 成功(naturalWidth>0 证明 200 字节确为可解码图片)。
  const naturalWidth = await thumb.evaluate(
    (el) => (el as HTMLImageElement).naturalWidth,
  );
  expect(naturalWidth).toBeGreaterThan(0);
});

import { test, expect, type FrameLocator, type Page } from "@playwright/test";

const SOURCE = "./examples/aigc-agent";

async function selectSource(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator("[data-agent-source-picker]")).toBeVisible();
  await page.locator("[data-agent-source-input]").fill(SOURCE);
  await page.locator("[data-agent-source-submit]").click();
  await expect(page.locator("[data-session-active]")).toBeVisible();
}

function videoFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[title="视频工作室"]');
}

test("aigc-agent: 方案→镜头历史→FFmpeg 媒体→视频轨道与音轨合成", async ({ page }) => {
  test.setTimeout(120_000);
  await selectSource(page);
  const frame = videoFrame(page);
  await expect(frame.locator("[data-video-studio]")).toBeVisible({ timeout: 30_000 });

  await frame.locator("[data-video-brief]").fill("清晨海边咖啡店，两镜头电影感短片");
  await frame.locator("[data-video-create-plan]").click();
  await expect(frame.locator("[data-video-shot]")).toHaveCount(2, { timeout: 30_000 });
  await expect(frame.locator('[data-video-shot="shot-01"]')).toContainText("提示词历史 · 2");

  await frame.locator('[data-video-shot="shot-01"] button', { hasText: "发送至 Agent 生成" }).click();
  await expect(frame.locator('[data-video-shot="shot-01"]')).toContainText("已完成", { timeout: 45_000 });
  await expect(frame.locator('[data-video-shot="shot-02"]')).toContainText("已完成", { timeout: 15_000 });
  await expect(frame.locator('[data-video-shot="shot-01"]')).toContainText("视频历史 · 1");
  await expect(frame.locator('[data-video-shot="shot-02"]')).toContainText("视频历史 · 1");

  const addToTrack = frame.locator('[aria-label="加入视频轨道"]');
  await expect(addToTrack).toHaveCount(2);
  await addToTrack.nth(0).click();
  await addToTrack.nth(1).click();
  await expect(frame.locator("[data-video-timeline] [class*='video-timeline-item']")).toHaveCount(2);
  await expect(frame.locator("[data-video-audio-card]")).toContainText("att_");

  await frame.getByRole("button", { name: "按音轨生成视频" }).click();
  const timeline = frame.locator("[data-video-timeline-card]");
  await expect(timeline).toContainText("最终输出：att_", { timeout: 45_000 });
  const timelineText = await timeline.textContent();
  const outputId = timelineText?.match(/最终输出：(att_[A-Za-z0-9_-]+)/)?.[1];
  expect(outputId).toBeTruthy();

  const probe = await page.evaluate(async (id) => {
    const response = await fetch(`/api/attachments/${id}/raw`);
    return { status: response.status, contentType: response.headers.get("content-type") ?? "", bytes: (await response.arrayBuffer()).byteLength };
  }, outputId!);
  expect(probe.status).toBe(200);
  expect(probe.contentType).toContain("video/");
  expect(probe.bytes).toBeGreaterThan(0);
  await expect(page.locator("[data-pi-error-banner]")).not.toBeVisible();
});

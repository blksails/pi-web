import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { createVideoPlan, emptyVideoStudioState } from "./model.js";
import { evaluateRenderedVideo, evaluateVideoProject } from "./evaluation.js";
import { ffmpegRendererAdapter } from "./renderer.js";

test("quality report separates structural warnings from blocking evidence", () => {
  const project = createVideoPlan(emptyVideoStudioState(), "猫寻找灯塔", {}).project!;
  const report = evaluateVideoProject(project);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.projectId, project.id);
  assert.equal(report.blockingFindings.length, 0);
  assert.ok(report.checks.some((check) => check.dimension === "narrative" && check.status === "warn"));
  assert.ok(report.checks.find((check) => check.dimension === "generation")?.affectedNodeIds.includes(`shot:${project.shots[0]!.id}`));
});

test("quality report records real MP4 decode evidence", async () => {
  const project = createVideoPlan(emptyVideoStudioState(), "可播放 POC", {}).project!;
  const dir = await mkdtemp(join(process.env.TEMP ?? ".", "pi-video-quality-"));
  const outputPath = join(dir, "quality.mp4");
  try {
    await ffmpegRendererAdapter.render({
      outputPath,
      width: 320,
      height: 180,
      fps: 12,
      shots: [{ id: "shot-1", durationSec: 1, source: { kind: "color", value: "green" } }],
      transitions: [],
    });
    const report = await evaluateRenderedVideo(project, "att-quality-video", outputPath);
    const artifact = report.checks.find((check) => check.id === "artifact-decode");
    assert.equal(artifact?.status, "pass");
    assert.deepEqual(report.blockingFindings, []);
    assert.equal(report.artifactAttachmentId, "att-quality-video");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

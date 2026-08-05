import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { buildFfmpegRenderPlan, ffmpegRendererAdapter, type VideoRenderRequest } from "./renderer.js";
import { renderAttachmentImagesToMp4 } from "./renderer.js";

function request(outputPath: string): VideoRenderRequest {
  const colors = ["red", "orange", "yellow", "green", "cyan", "blue", "purple", "white"];
  return {
    outputPath,
    width: 320,
    height: 180,
    fps: 12,
    shots: colors.map((color, index) => ({ id: `shot-${index + 1}`, durationSec: 0.25, source: { kind: "color" as const, value: color } })),
    transitions: ["cut", "fade", "dissolve", "wipe", "match-cut", "morph", "cut"],
  };
}

function assertDecodable(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
}

function createImage(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=320x180", "-frames:v", "1", path], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
}

test("renderer plan keeps engine boundary and reports unsupported transition degradation", () => {
  const plan = buildFfmpegRenderPlan(request("out.mp4"));
  assert.match(plan.args.join(" "), /concat=n=8/);
  assert.deepEqual(plan.actualTransitions, ["cut", "fade", "cut"]);
  assert.deepEqual(plan.degradedTransitions, ["dissolve", "wipe", "match-cut", "morph"]);
  assert.equal(plan.estimatedDurationSec, 2);
});

test("ffmpeg adapter produces a real playable eight-shot MP4", async () => {
  const dir = await mkdtemp(join(process.env.TEMP ?? ".", "pi-video-render-"));
  const outputPath = join(dir, "eight-shot.mp4");
  try {
    const result = await ffmpegRendererAdapter.render(request(outputPath));
    const file = await stat(outputPath);
    const header = await readFile(outputPath);
    assert.equal(result.engine, "ffmpeg");
    assert.ok(file.size > 1000);
    assert.equal(header.toString("ascii", 4, 8), "ftyp");
    await assertDecodable(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("attachment image sources render and return a stable MP4 attachment", async () => {
  const dir = await mkdtemp(join(process.env.TEMP ?? ".", "pi-video-attachment-"));
  const imagePath = join(dir, "source.png");
  try {
    await createImage(imagePath);
    let persistedBytes = 0;
    const result = await renderAttachmentImagesToMp4({
      outputName: "attachment-render.mp4",
      width: 320,
      height: 180,
      fps: 12,
      shots: Array.from({ length: 8 }, (_, index) => ({ id: `shot-${index + 1}`, durationSec: 0.2, source: { kind: "attachment" as const, attachmentId: "att-source-image" } })),
      transitions: ["cut", "fade", "cut", "fade", "cut", "fade", "cut"],
    }, {
      resolve: async (attachmentId) => {
        assert.equal(attachmentId, "att-source-image");
        return { localPath: async () => imagePath };
      },
      putOutput: async ({ bytes, name, mimeType }) => {
        persistedBytes = bytes.byteLength;
        assert.equal(name, "attachment-render.mp4");
        assert.equal(mimeType, "video/mp4");
        return { attachmentId: "att-rendered-video", displayUrl: "https://example.test/att-rendered-video" };
      },
    });
    assert.equal(result.attachmentId, "att-rendered-video");
    assert.ok(persistedBytes > 1000);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

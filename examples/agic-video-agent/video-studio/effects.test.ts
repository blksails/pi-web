import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { applyFfmpegVfx, buildFfmpegVfxPlan, validateVfxSpec, type VfxSpec } from "./effects.js";
import { ffmpegRendererAdapter } from "./renderer.js";

const spec: VfxSpec = {
  schemaVersion: 1,
  id: "vfx-multi-layer",
  layers: [
    { id: "grade", kind: "color-grade", contrast: 1.15, saturation: 1.2, brightness: 0.04 },
    { id: "vignette", kind: "vignette", angle: Math.PI / 4 },
    { id: "frame", kind: "shape", x: 8, y: 8, width: 120, height: 32, color: "red@0.35" },
    { id: "title", kind: "text", text: "Pi: Video, 2026", x: 18, y: 32, fontSize: 20, color: "white" },
  ],
};

function decode(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr)));
  });
}

test("VFX plan validates and serializes four deterministic layers safely", () => {
  const result = validateVfxSpec(spec);
  assert.equal(result.ok, true);
  const plan = buildFfmpegVfxPlan(spec);
  assert.deepEqual(plan.appliedLayers, ["grade", "vignette", "frame", "title"]);
  assert.match(plan.filter, /eq=contrast=1\.15/);
  assert.match(plan.filter, /vignette=/);
  assert.match(plan.filter, /drawbox=/);
  assert.match(plan.filter, /drawtext=text='Pi\\: Video\\, 2026'/);
  assert.equal(validateVfxSpec({ ...spec, layers: [{ id: "unsafe", kind: "shape", x: 0, y: 0, width: 1, height: 1, color: "red;rm -rf" }] }).ok, false);
});

test("multi-layer VFX adapter produces a playable MP4", async () => {
  const dir = await mkdtemp(join(process.env.TEMP ?? ".", "pi-video-vfx-"));
  const inputPath = join(dir, "input.mp4");
  const outputPath = join(dir, "vfx.mp4");
  try {
    await ffmpegRendererAdapter.render({
      outputPath: inputPath,
      width: 320,
      height: 180,
      fps: 12,
      shots: [{ id: "shot-1", durationSec: 1, source: { kind: "color", value: "blue" } }],
      transitions: [],
    });
    const plan = await applyFfmpegVfx(inputPath, outputPath, spec);
    const output = await stat(outputPath);
    assert.equal(plan.appliedLayers.length, 4);
    assert.ok(output.size > 1000);
    await decode(outputPath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * ffmpeg 族 self-check(runnable):生成测试视频 → 跑 runLocal 工具 → 过 persistMedia。
 * 运行:从仓库根 `npx tsx packages/aigc-media-tools/test/ffmpeg.selfcheck.ts`
 * 需本机装 ffmpeg。零外部 key、离线可跑——验证 runLocal → data URI → persistMedia → putOutput 全链路。
 */
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AttachmentToolContext } from "@blksails/pi-web-agent-kit";
import { ffmpegRunLocal, ffmpegRoute } from "../src/providers/local-ffmpeg.js";
import { persistMedia } from "../src/persist-media.js";
import { runMediaTool } from "../src/run-media-tool.js";

function sh(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const c = spawn(cmd, args);
    let err = "";
    c.stderr?.on("data", (d) => (err += d.toString()));
    c.on("error", reject);
    c.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exit ${code}: ${err.slice(-300)}`));
    });
  });
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

function dataUriMime(url: string): string {
  return /^data:([^;,]+)/.exec(url)?.[1] ?? "";
}

/** 捕获 putOutput 的 mock attachment ctx。`resolveLocalPath`:att_→本地路径(测 att_ 输入解析)。 */
function mockCtx(resolveLocalPath?: string): { ctx: AttachmentToolContext; puts: { name: string; mimeType: string; bytes: number }[] } {
  const puts: { name: string; mimeType: string; bytes: number }[] = [];
  const ctx = {
    available: true,
    async putOutput({ bytes, name, mimeType }) {
      puts.push({ name, mimeType, bytes: bytes.length });
      return { attachmentId: `att_${puts.length}`, displayUrl: `/api/x/${name}`, name, mimeType };
    },
    async resolve(id: string) {
      if (!resolveLocalPath) throw new Error(`resolve not stubbed for ${id}`);
      return {
        meta: { mimeType: "video/mp4" },
        async bytes() { return new Uint8Array(); },
        async localPath() { return resolveLocalPath; },
        async url() { return `/api/attachments/${id}/raw`; },
      };
    },
    async listBySession() {
      return [];
    },
    async getMeta() {
      return undefined;
    },
    async setMeta() {},
  } as unknown as AttachmentToolContext;
  return { ctx, puts };
}

async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "media-selfcheck-"));
  const video = join(dir, "sample.mp4");
  try {
    console.log("[1] 生成 2s 测试视频(testsrc + sine 音轨)…");
    await sh("ffmpeg", [
      "-y",
      "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video,
    ]);
    assert(true, "测试视频已生成");

    console.log("[2] audio_extract → 应得 data:audio/mpeg");
    const audio = await ffmpegRunLocal.audioExtract({ video_url: video, format: "mp3" }, undefined);
    assert(audio.kind === "audio", `kind=audio (got ${audio.kind})`);
    assert("url" in audio && audio.url.startsWith("data:audio/mpeg;base64,"), `data:audio/mpeg URI (mime=${"url" in audio ? dataUriMime(audio.url) : "?"})`);

    console.log("[3] video_clip → 应得 data:video/mp4");
    const clip = await ffmpegRunLocal.videoClip({ video_url: video, duration_seconds: 1 }, undefined);
    assert(clip.kind === "video", `kind=video (got ${clip.kind})`);
    assert("url" in clip && clip.url.startsWith("data:video/mp4;base64,"), "data:video/mp4 URI");

    console.log("[4] video_extract_frame → 应得 data:image/png");
    const frame = await ffmpegRunLocal.videoExtractFrame({ video_url: video, timestamp_seconds: 0 }, undefined);
    assert(frame.kind === "image", `kind=image (got ${frame.kind})`);
    assert("url" in frame && frame.url.startsWith("data:image/png;base64,"), "data:image/png URI");

    console.log("[5] persistMedia(audio) → putOutput 收到 audio/mpeg 字节");
    const { ctx, puts } = mockCtx();
    const persisted = await persistMedia(audio, ctx, { namePrefix: "selfcheck" });
    assert(persisted !== null && persisted.kind === "audio", "persisted kind=audio");
    assert(persisted!.assets.length === 1, "1 个资产落库");
    assert(puts.length === 1 && puts[0]!.mimeType === "audio/mpeg" && puts[0]!.bytes > 0, `putOutput audio/mpeg ${puts[0]?.bytes} bytes`);
    assert(persisted!.assets[0]!.attachmentId === "att_1", "返回稳定 attachmentId");

    console.log("[6] runMediaTool + att_ 输入 → 走 localFileFields(att_→localPath),不再报「输入 URL 无效」");
    const { ctx: ctx2, puts: puts2 } = mockCtx(video); // resolve(att_).localPath() → 测试视频
    const route = ffmpegRoute("ffmpeg-extract-audio", "L", "D", ffmpegRunLocal.audioExtract);
    const noUiExt = { hasUI: false } as unknown as Parameters<typeof runMediaTool>[1];
    const res = await runMediaTool(
      { video_url: "att_EcvzTEST", format: "mp3" },
      noUiExt,
      undefined,
      undefined,
      {
        toolName: "audio_extract",
        routes: [route],
        defaultModel: route.model,
        requiredParams: [],
        localFileFields: ["video_url"],
        deps: { getCtx: () => ctx2 },
      },
    );
    assert(res.details?.ok === true, `att_ 输入成功(details.ok=${res.details?.ok})`);
    assert(res.details?.ok === true && res.details.kind === "audio", "kind=audio");
    assert(puts2.length === 1 && puts2[0]!.mimeType === "audio/mpeg", "putOutput 落 audio/mpeg");

    console.log("\n✅ ffmpeg 族 self-check 全通过");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("\n❌ self-check 失败:", e instanceof Error ? e.message : e);
  process.exit(1);
});

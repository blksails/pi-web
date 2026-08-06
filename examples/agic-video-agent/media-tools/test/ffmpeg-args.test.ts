import test from "node:test";
import assert from "node:assert/strict";
import { videoWithAudioArgs } from "../src/providers/local-ffmpeg.js";

test("video_with_audio args carry trim, placement and volume", () => {
  const args = videoWithAudioArgs("video.mp4", "audio.mp3", "out.mp4", "replace", {
    audioStartSeconds: 1.5,
    audioTrimStartSeconds: 2,
    audioDurationSeconds: 4,
    audioVolume: 0.6,
  });
  assert.deepEqual(args.slice(0, 10), ["-y", "-i", "video.mp4", "-ss", "2", "-t", "4", "-i", "audio.mp3", "-filter_complex"]);
  assert.ok(args.includes("[1:a]volume=0.6,adelay=1500|1500[audio_track]"));
  assert.ok(args.includes("-map"));
  assert.ok(args.includes("[audio_track]"));
});

test("video_with_audio mix keeps the original audio and delays the added track", () => {
  const args = videoWithAudioArgs("video.mp4", "audio.mp3", "out.mp4", "mix", { audioStartSeconds: 0.25 });
  const filter = args[args.indexOf("-filter_complex") + 1];
  assert.equal(filter, "[1:a]volume=1,adelay=250|250[audio_track];[0:a][audio_track]amix=inputs=2:duration=longest:dropout_transition=2[aout]");
  assert.ok(args.includes("[aout]"));
});

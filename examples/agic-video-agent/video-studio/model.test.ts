import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShotPrompt,
  addVideoToTimeline,
  createVideoPlan,
  createVideoPlanFromAgent,
  deletePromptHistory,
  deleteVideoHistory,
  emptyVideoStudioState,
  markVideoExportRequested,
  patchVideoShot,
  setAudioTrack,
  selectPromptVersion,
  setVideoShotAsset,
  trimAudioTrack,
} from "./model.js";

test("video plan stays within first-version bounds and is editable", () => {
  const state = createVideoPlan(emptyVideoStudioState(), "一只猫在雨夜寻找灯塔", {
    title: "雨夜灯塔",
    aspectRatio: "9:16",
    targetDurationSec: 20,
  });
  assert.equal(state.project?.title, "雨夜灯塔");
  assert.equal(state.project?.aspectRatio, "9:16");
  assert.equal(state.project?.shots.length, 4);
  assert.ok((state.project?.shots.length ?? 0) <= 6);
  const first = state.project!.shots[0]!;
  const edited = patchVideoShot(state, first.id, { prompt: "猫在雨幕中抬头，镜头缓慢推进" });
  assert.equal(edited.project?.shots[0]?.prompt, "猫在雨幕中抬头，镜头缓慢推进");
  assert.match(buildShotPrompt(edited.project!, edited.project!.shots[0]!), /雨夜灯塔/);
});

test("shot lifecycle records an attachment and export request", () => {
  const planned = createVideoPlan(emptyVideoStudioState(), "海边咖啡店", { targetDurationSec: 15 });
  const shotId = planned.project!.shots[0]!.id;
  const running = patchVideoShot(planned, shotId, { status: "generating", progress: 40 });
  const done = setVideoShotAsset(running, shotId, { attachmentId: "att_video_1", previewUrl: "https://example.test/video.mp4" });
  assert.equal(done.project?.shots[0]?.status, "done");
  assert.equal(done.project?.shots[0]?.attachmentId, "att_video_1");
  const exported = markVideoExportRequested(done);
  assert.equal(exported.project?.exportStatus, "requested");
  assert.ok(exported.events.some((event) => event.type === "generation_finished"));
});

test("agent plan and version history survive repeated generation", () => {
  const planned = createVideoPlanFromAgent(emptyVideoStudioState(), "一只猫在雨夜寻找灯塔", {
    title: "Agent 雨夜",
    aspectRatio: "9:16",
    targetDurationSec: 10,
  }, [
    { title: "雨夜开场", prompt: "猫在雨幕中抬头，镜头缓慢推进", durationSec: 5 },
    { title: "灯塔出现", prompt: "灯塔光束扫过海面，猫向前奔跑", durationSec: 5 },
  ]);
  const shot = planned.project!.shots[0]!;
  assert.equal(shot.promptHistory[0]?.source, "agent");
  const edited = patchVideoShot(planned, shot.id, { prompt: "猫穿过积水街道，低机位跟拍", promptSource: "user" });
  const restored = selectPromptVersion(edited, shot.id, shot.activePromptId!);
  assert.equal(restored.project!.shots[0]!.prompt, shot.prompt);
  const first = setVideoShotAsset(restored, shot.id, { attachmentId: "att_video_1" });
  const second = setVideoShotAsset(first, shot.id, { attachmentId: "att_video_2" });
  const current = second.project!.shots[0]!;
  assert.equal(current.videoHistory.length, 2);
  assert.equal(current.videoHistory[0]?.promptVersionId, current.videoHistory[1]?.promptVersionId);
  assert.equal(current.attachmentId, "att_video_2");

  const withPromptRemoved = deletePromptHistory(second, shot.id, current.activePromptId!);
  assert.equal(withPromptRemoved.project!.shots[0]!.promptHistory.length, 1);
  const withVideoRemoved = deleteVideoHistory(withPromptRemoved, shot.id, current.videoHistory[1]!.id);
  assert.equal(withVideoRemoved.project!.shots[0]!.videoHistory.length, 1);
  assert.equal(withVideoRemoved.project!.shots[0]!.attachmentId, "att_video_1");
});

test("selected video can enter timeline and audio track can be trimmed", () => {
  const planned = createVideoPlanFromAgent(emptyVideoStudioState(), "海边咖啡店", {}, [
    { title: "开场", prompt: "海边咖啡店清晨开门", durationSec: 5 },
  ]);
  const shotId = planned.project!.shots[0]!.id;
  const withVideo = setVideoShotAsset(planned, shotId, { attachmentId: "att_video_1" });
  const withClip = addVideoToTimeline(withVideo, shotId);
  assert.equal(withClip.project!.timeline.videoClips[0]?.attachmentId, "att_video_1");
  const withAudio = setAudioTrack(withClip, { attachmentId: "att_audio_1", durationSec: 8, mode: "mix" });
  const trimmed = trimAudioTrack(withAudio, 2, 4);
  assert.equal(trimmed.project!.timeline.audioTrack?.trimStartSec, 2);
  assert.equal(trimmed.project!.timeline.audioTrack?.durationSec, 4);
  assert.equal(trimmed.project!.timeline.audioTrack?.mode, "mix");
});

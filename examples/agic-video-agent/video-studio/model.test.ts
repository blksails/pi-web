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
  applyVideoTransaction,
  MAX_VIDEO_SHOTS,
  VIDEO_PROJECT_SCHEMA_VERSION,
  validateVideoProject,
} from "./model.js";
import { validateVideoAnalysis } from "./analysis.js";

test("video plan stays within first-version bounds and is editable", () => {
  const state = createVideoPlan(emptyVideoStudioState(), "一只猫在雨夜寻找灯塔", {
    title: "雨夜灯塔",
    aspectRatio: "9:16",
    targetDurationSec: 20,
  });
  assert.equal(state.project?.title, "雨夜灯塔");
  assert.equal(state.project?.aspectRatio, "9:16");
  assert.equal(state.project?.shots.length, 4);
  assert.ok((state.project?.shots.length ?? 0) <= MAX_VIDEO_SHOTS);
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

test("project exposes stable scene, transition, and continuity structure", () => {
  const first = createVideoPlan(emptyVideoStudioState(), "一只猫在雨夜寻找灯塔", { title: "雨夜灯塔" });
  const second = createVideoPlan(emptyVideoStudioState(), "一只猫在雨夜寻找灯塔", { title: "雨夜灯塔" });
  const project = first.project!;
  assert.equal(project.schemaVersion, VIDEO_PROJECT_SCHEMA_VERSION);
  assert.equal(project.scenes.length, 1);
  assert.equal(project.scenes[0]?.shotIds.length, project.shots.length);
  assert.equal(project.transitions.length, project.shots.length - 1);
  assert.equal(project.continuity.length, project.shots.length - 1);
  assert.equal(first.project?.id, second.project?.id);
  assert.deepEqual(first.project?.shots.map((shot) => shot.id), second.project?.shots.map((shot) => shot.id));
  assert.deepEqual(first.project?.transitions.map((item) => item.id), second.project?.transitions.map((item) => item.id));
});

test("video transaction validates structure and rolls back atomically", () => {
  const planned = createVideoPlan(emptyVideoStudioState(), "海边咖啡店", {});
  const firstShot = planned.project!.shots[0]!;
  const secondShot = planned.project!.shots[1]!;
  const applied = applyVideoTransaction(planned, {
    id: "tx-structure-1",
    source: "agent",
    expectedSchemaVersion: VIDEO_PROJECT_SCHEMA_VERSION,
    commands: [
      { type: "set-transition", fromShotId: firstShot.id, toShotId: secondShot.id, transition: "dissolve", durationSec: 0.6 },
      { type: "set-continuity", fromShotId: firstShot.id, toShotId: secondShot.id, kind: "character", status: "verified", confidence: 0.92 },
    ],
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.applied, 2);
  assert.equal(applied.state.project?.transitions[0]?.type, "dissolve");
  assert.equal(applied.state.project?.continuity.find((item) => item.kind === "character")?.confidence, 0.92);

  const rejected = applyVideoTransaction(applied.state, {
    id: "tx-structure-2",
    source: "agent",
    commands: [{ type: "set-transition", fromShotId: firstShot.id, toShotId: "missing-shot", transition: "fade" }],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.applied, 0);
  assert.equal(rejected.state.project?.transitions[0]?.type, "dissolve");
});

test("project validation rejects legacy-shaped input until normalized", () => {
  const planned = createVideoPlan(emptyVideoStudioState(), "旧快照", {});
  const invalid = validateVideoProject({ ...planned.project!, scenes: undefined });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((error) => error.includes("project.scenes")));
  const valid = validateVideoProject(planned.project);
  assert.equal(valid.ok, true);
  assert.equal(valid.value?.schemaVersion, VIDEO_PROJECT_SCHEMA_VERSION);
});

test("analysis requires evidence and enters project only through validated transaction", () => {
  const analysis = {
    schemaVersion: 1,
    id: "analysis-1",
    sourceAttachmentId: "att_source_video",
    status: "complete" as const,
    createdAt: "2026-08-05T00:00:00.000Z",
    technical: {
      facts: [{ id: "fact-duration", category: "technical", claim: "时长", value: "8 秒", confidence: 0.99, evidenceIds: ["meta-1"] }],
      durationSec: 8,
      width: 1920,
      height: 1080,
      fps: 24,
      codec: "h264",
      hasAudio: true,
    },
    timeline: {
      facts: [],
      segments: [{ id: "segment-1", startSec: 0, endSec: 8, label: "完整片段", confidence: 0.9, evidenceIds: ["meta-1"] }],
    },
    visual: { facts: [], subjects: ["猫"], cameraLanguage: "低机位跟拍", palette: ["蓝"], style: "电影感" },
    narrative: { facts: [], logline: "猫寻找灯塔", beats: [], characters: ["猫"], locations: ["海边"], tone: "克制" },
    generation: { facts: [], prompt: "猫在雨夜寻找灯塔", modelHints: ["保持角色连续"], sourceAssets: ["att_source_video"], unavailable: ["无法恢复原始模型 seed"] },
    evidence: [{ id: "meta-1", source: "metadata" as const, claim: "媒体元数据", confidence: 0.99, locator: "ffprobe" }],
    corrections: [],
    unresolved: ["原始生成模型不可恢复"],
  };
  assert.equal(validateVideoAnalysis(analysis).ok, true);
  const planned = createVideoPlan(emptyVideoStudioState(), "猫寻找灯塔", {});
  const applied = applyVideoTransaction(planned, {
    id: "tx-analysis-1",
    source: "agent",
    commands: [{ type: "set-analysis", analysis }],
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.state.project?.analysis?.sourceAttachmentId, "att_source_video");

  const rejected = applyVideoTransaction(planned, {
    id: "tx-analysis-2",
    source: "agent",
    commands: [{ type: "set-analysis", analysis: { ...analysis, evidence: [] } }],
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.state.project?.analysis, undefined);
});

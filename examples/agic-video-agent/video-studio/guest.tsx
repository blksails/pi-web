import * as React from "react";
import { createRoot } from "react-dom/client";
import {
  AudioLines,
  Check,
  Clapperboard,
  Download,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import { PaneGuestProvider, usePaneGuest } from "@blksails/pi-web-panes-kit/react";
import {
  buildShotPrompt,
  emptyVideoStudioState,
  normalizeVideoStudioState,
  VIDEO_STUDIO_STATE_KEY,
  type VideoAutomation,
  type VideoProject,
  type VideoShot,
  type VideoShotStatus,
  type VideoStudioState,
} from "./model.js";
import type { VideoQualityReport } from "./evaluation.js";
import { installVideoStudioStyles } from "./styles.js";

function readState(value: unknown): VideoStudioState {
  return normalizeVideoStudioState(value ?? emptyVideoStudioState());
}

const STATUS_LABEL: Readonly<Record<VideoShotStatus, string>> = {
  draft: "草案",
  queued: "排队",
  generating: "生成中",
  paused: "已暂停",
  review: "待复核",
  done: "已完成",
  failed: "失败",
};

function shotCount(project: VideoProject | null, status: VideoShotStatus): number {
  return project?.shots.filter((shot) => shot.status === status).length ?? 0;
}

function timestamp(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function numberValue(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function readQualityReport(value: unknown): VideoQualityReport | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const report = (value as { report?: unknown }).report;
  if (typeof report !== "object" || report === null) return undefined;
  const candidate = report as Partial<VideoQualityReport>;
  return typeof candidate.status === "string" && typeof candidate.overallScore === "number"
    ? report as VideoQualityReport
    : undefined;
}

export function VideoStudioApp(): React.JSX.Element {
  const guest = usePaneGuest();
  const [state, setState] = React.useState<VideoStudioState>(() => readState(guest.surface.getState(VIDEO_STUDIO_STATE_KEY)));
  const [brief, setBrief] = React.useState("");
  const [title, setTitle] = React.useState("未命名视频项目");
  const [aspectRatio, setAspectRatio] = React.useState<VideoProject["aspectRatio"]>("16:9");
  const [automation, setAutomation] = React.useState<VideoAutomation>("assisted");
  const [duration, setDuration] = React.useState("15");
  const [selectedShotId, setSelectedShotId] = React.useState<string>();
  const [editingShotId, setEditingShotId] = React.useState<string>();
  const [editingBrief, setEditingBrief] = React.useState(false);
  const [editPrompt, setEditPrompt] = React.useState("");
  const [busy, setBusy] = React.useState<string>();
  const [message, setMessage] = React.useState("");
  const [audioAttachmentId, setAudioAttachmentId] = React.useState("");
  const [audioStart, setAudioStart] = React.useState("0");
  const [audioTrimStart, setAudioTrimStart] = React.useState("0");
  const [audioDuration, setAudioDuration] = React.useState("");
  const [audioVolume, setAudioVolume] = React.useState("1");
  const [audioMode, setAudioMode] = React.useState<"replace" | "mix">("replace");
  const [qualityReport, setQualityReport] = React.useState<VideoQualityReport>();

  React.useEffect(() => guest.surface.subscribe(VIDEO_STUDIO_STATE_KEY, (value) => setState(readState(value))), [guest]);

  const project = state.project;
  const selectedShot = project?.shots.find((shot) => shot.id === (selectedShotId ?? project.activeShotId)) ?? project?.shots[0];
  const audioTrack = project?.timeline.audioTrack;

  React.useEffect(() => {
    if (audioTrack === undefined) return;
    setAudioAttachmentId(audioTrack.attachmentId);
    setAudioStart(String(audioTrack.startSec));
    setAudioTrimStart(String(audioTrack.trimStartSec));
    setAudioDuration(audioTrack.durationSec === undefined ? "" : String(audioTrack.durationSec));
    setAudioVolume(String(audioTrack.volume));
    setAudioMode(audioTrack.mode);
  }, [audioTrack?.attachmentId, audioTrack?.updatedAt]);

  const run = async (action: string, args: unknown = {}): Promise<unknown> => {
    setBusy(action);
    setMessage("");
    try {
      return await guest.surface.run("video-studio", action, args);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setBusy(undefined);
    }
  };

  const createPlan = async (): Promise<void> => {
    setBusy("plan");
    setMessage("Agent 正在生成结构化镜头方案…");
    try {
      await guest.submitUserMessage([
        "请调用 video_plan 工具生成结构化视频镜头方案，不要只回复文字。",
        `项目标题：${title}`,
        `创意简报：${brief}`,
        `画幅：${aspectRatio}；目标时长：${Number(duration) || 15} 秒；自动化：${automation}`,
        "请拆成 3–6 个镜头；每个 prompt 写清主体、动作、运镜、光线、连续性、负向约束与时长，能直接交给视频模型执行。",
      ].join("\n"));
      setMessage("已请求 Agent 生成方案；结构化镜头会自动回到此处");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(undefined);
    }
  };

  const submitShot = async (shot: VideoShot, mode: "submit" | "stage"): Promise<void> => {
    if (project === null) return;
    const prompt = buildShotPrompt(project, shot);
    try {
      if (mode === "stage") await guest.stageUserMessage(prompt);
      else await guest.submitUserMessage(prompt);
      setMessage(mode === "stage" ? "已暂存完整镜头请求，可继续编辑后发送" : `已发送镜头 ${shot.index} 至 Agent，生成结果将回流并保留版本`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const startShot = async (shot: VideoShot): Promise<void> => {
    const result = await run(shot.status === "paused" ? "resume-shot" : "queue-shot", { shotId: shot.id });
    if (result !== undefined) await submitShot(shot, "submit");
  };

  const autoGenerate = async (): Promise<void> => {
    if (project === null) return;
    const result = await run("queue-all");
    if (result === undefined) return;
    try {
      await guest.submitUserMessage([
        `请按项目「${project.title}」逐镜头自动生成，完成一镜后再继续下一镜；每一镜必须调用一次合适的视频媒体工具。`,
        `画幅 ${project.aspectRatio}，目标时长 ${project.targetDurationSec} 秒。`,
        ...project.shots.map((shot) => buildShotPrompt(project, shot)),
      ].join("\n\n"));
      setMessage("自动流程已启动；可随时暂停、修改或重试单个镜头");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const regeneratePrompt = async (shot: VideoShot): Promise<void> => {
    if (project === null) return;
    try {
      await guest.submitUserMessage([
        "请调用 video_shot_prompt 工具重新生成镜头提示词，不要只回复文字。",
        `shot_id：${shot.id}`,
        `项目：${project.title}；画幅：${project.aspectRatio}；时长：${shot.durationSec} 秒。`,
        `当前提示词：${shot.prompt}`,
        "新提示词需保留主体连续性，并补齐动作、运镜、光线、节奏和负向约束；只生成一版可直接执行的提示词。",
      ].join("\n"));
      setMessage(`已请求 Agent 重写 ${shot.id} 提示词，新版本会保留在历史中`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const requestExport = async (): Promise<void> => {
    if (project === null) return;
    const result = await run("request-export");
    if (result === undefined) return;
    const clips = project.timeline.videoClips.map((clip) => clip.attachmentId);
    const track = project.timeline.audioTrack;
    try {
      await guest.submitUserMessage([
        `请调用 video_concat，按视频轨道顺序合成：${clips.join(", ")}。`,
        track === undefined ? "没有音轨，直接输出合成视频。" : `合成后调用 video_with_audio：video_url 使用 concat 产物，audio_url=${track.attachmentId}，audio_trim_start_seconds=${track.trimStartSec}，audio_duration_seconds=${track.durationSec ?? "省略"}，audio_start_seconds=${track.startSec}，audio_volume=${track.volume}，mode=${track.mode}。`,
        `保持项目画幅 ${project.aspectRatio}；工具完成后返回最终 attachment id。`,
      ].join("\n"));
      setMessage("已提交视频轨道合成；若有音轨会继续套入当前音频");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const generateWithAudio = async (): Promise<void> => {
    if (project === null || audioAttachmentId.trim() === "" || project.timeline.videoClips.length === 0) {
      setMessage("请先把视频版本加入轨道，并填写音频 attachment id");
      return;
    }
    try {
      await guest.submitUserMessage([
        `请调用 video_concat 合成视频轨道：${project.timeline.videoClips.map((clip) => clip.attachmentId).join(", ")}。`,
        `再调用 video_with_audio，将 audio_url=${audioAttachmentId.trim()} 套入合成视频；mode=${audioMode}，audio_trim_start_seconds=${audioTrimStart || "0"}，audio_duration_seconds=${audioDuration || "省略"}，audio_start_seconds=${audioStart || "0"}，audio_volume=${audioVolume || "1"}。`,
        "返回最终视频 attachment id，并将其作为时间线输出。",
      ].join("\n"));
      setMessage("已发送带音轨生成请求");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };

  const applyAudioTrack = async (): Promise<void> => {
    if (audioAttachmentId.trim() === "") {
      setMessage("请填写音频 attachment id");
      return;
    }
    await run("set-audio-track", {
      attachmentId: audioAttachmentId.trim(),
      startSec: numberValue(audioStart) ?? 0,
      trimStartSec: numberValue(audioTrimStart) ?? 0,
      ...(numberValue(audioDuration) !== undefined ? { durationSec: numberValue(audioDuration) } : {}),
      volume: numberValue(audioVolume) ?? 1,
      mode: audioMode,
    });
  };

  const trimAudio = async (): Promise<void> => {
    await run("trim-audio-track", { trimStartSec: numberValue(audioTrimStart) ?? 0, durationSec: numberValue(audioDuration) ?? 1 });
  };

  const evaluateProject = async (): Promise<void> => {
    if (project === null) return;
    const result = await run("evaluate", project.timeline.outputVideo?.attachmentId === undefined
      ? {}
      : { artifactAttachmentId: project.timeline.outputVideo.attachmentId });
    const report = readQualityReport(result);
    if (report === undefined) return;
    setQualityReport(report);
    setMessage(`工程质检完成：${report.status} · ${Math.round(report.overallScore * 100)} 分`);
  };

  const beginEdit = (shot: VideoShot): void => {
    setEditingShotId(shot.id);
    setEditPrompt(shot.prompt);
  };

  const saveEdit = async (shot: VideoShot): Promise<void> => {
    const result = await run("update-shot", { shotId: shot.id, prompt: editPrompt });
    if (result !== undefined) setEditingShotId(undefined);
  };

  const saveBrief = async (): Promise<void> => {
    const result = await run("update-brief", { brief, title, aspectRatio, automation });
    if (result !== undefined) {
      setEditingBrief(false);
      setMessage("项目简报已更新，既有镜头历史保持不变");
    }
  };

  return (
    <div data-video-studio>
      <header className="video-toolbar">
        <Clapperboard size={17} aria-hidden />
        <h2>视频工作室</h2>
        <small>Agent 方案 → 镜头版本 → 视频轨道 → 音轨 → 合成</small>
        <span className="video-grow" />
        {message !== "" ? <small role="status" aria-live="polite">{message}</small> : null}
        <button type="button" className="video-button" data-video-stage-project onClick={() => project !== null && void guest.stageUserMessage(`项目简报：${project.brief}`)} disabled={project === null}>
          <Send size={14} aria-hidden />带入项目简报
        </button>
        <button type="button" className="video-button" onClick={() => { if (project !== null) { setBrief(project.brief); setTitle(project.title); setAspectRatio(project.aspectRatio); setAutomation(project.automation); setEditingBrief(true); } }} disabled={project === null}>
          <Pencil size={14} aria-hidden />编辑简报
        </button>
      </header>
      <div className="video-body">
        <main className="video-main">
          {project === null ? (
            <section className="video-card" data-video-brief-card>
              <h3>新建视频项目</h3>
              <label className="video-label" htmlFor="video-brief">创意简报</label>
              <textarea id="video-brief" className="video-textarea" data-video-brief value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="例如：一支 15 秒竖屏短片，清晨的海边咖啡店，一只橘猫追着纸飞机…" />
              <div className="video-fields">
                <label><span className="video-label">项目名</span><input className="video-input" value={title} onChange={(event) => setTitle(event.target.value)} /></label>
                <label><span className="video-label">目标时长</span><input className="video-input" inputMode="numeric" value={duration} onChange={(event) => setDuration(event.target.value.replace(/\D/g, ""))} /></label>
                <label><span className="video-label">画幅</span><select className="video-select" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as VideoProject["aspectRatio"])}><option value="16:9">横版 16:9</option><option value="9:16">竖版 9:16</option><option value="1:1">方形 1:1</option></select></label>
                <label><span className="video-label">自动化</span><select className="video-select" value={automation} onChange={(event) => setAutomation(event.target.value as VideoAutomation)}><option value="manual">手动</option><option value="assisted">协作</option><option value="automatic">自动</option></select></label>
              </div>
              <div className="video-actions"><button type="button" className="video-button primary" data-video-create-plan onClick={() => void createPlan()} disabled={busy !== undefined || brief.trim() === ""}><Sparkles size={14} aria-hidden />让 Agent 生成镜头方案</button><span className="video-muted">方案由 Agent 写入 Surface；提示词与视频版本持续保留。</span></div>
            </section>
          ) : (
            <>
              <section className="video-preview" data-video-preview>
                {(project.timeline.outputVideo?.previewUrl ?? selectedShot?.previewUrl) !== undefined ? <video src={project.timeline.outputVideo?.previewUrl ?? selectedShot?.previewUrl} controls playsInline /> : <div className="video-preview-placeholder"><div><strong>{selectedShot?.title ?? project.title}</strong><span>{selectedShot?.prompt ?? project.brief}</span></div></div>}
                {selectedShot !== undefined ? <div className="video-preview-meta"><span className="video-status">镜头 {selectedShot.index} · {STATUS_LABEL[selectedShot.status]}</span><div className="video-progress"><span style={{ width: `${selectedShot.progress}%` }} /></div><span>{selectedShot.progress}%</span></div> : null}
              </section>
              <section className="video-card" data-video-timeline-card>
                <div className="video-label"><span>视频轨道</span><span>{project.targetDurationSec}s · {project.aspectRatio}</span></div>
                <div className="video-timeline" data-video-timeline>{project.timeline.videoClips.length === 0 ? <span className="video-muted">暂无片段；在镜头视频历史中点击“加入轨道”。</span> : project.timeline.videoClips.map((clip, index) => <div className="video-timeline-item active" key={clip.id}><button type="button" onClick={() => setSelectedShotId(clip.shotId)}><strong>{String(index + 1).padStart(2, "0")}</strong><small>{clip.attachmentId} · {clip.durationSec}s</small></button><button type="button" className="video-icon-button" aria-label="移除轨道片段" title="移除" onClick={() => void run("remove-from-timeline", { clipId: clip.id })}><Trash2 size={13} /></button></div>)}</div>
                {project.timeline.outputVideo?.attachmentId !== undefined ? <p className="video-muted">最终输出：{project.timeline.outputVideo.attachmentId}</p> : null}
              </section>
              <section className="video-card" data-video-quality>
                <div className="video-label"><span>工程质检</span><span>{project.analysis === undefined ? "尚未拆解" : "已附加拆解"}</span></div>
                <div className="video-quality-grid"><div><strong>{project.scenes.length}</strong><span>场景</span></div><div><strong>{project.transitions.length}</strong><span>转场</span></div><div><strong>{project.continuity.length}</strong><span>连续性</span></div><div><strong>{project.analysis?.evidence.length ?? 0}</strong><span>证据</span></div></div>
                <div className="video-actions"><button type="button" className="video-button" onClick={() => void evaluateProject()} disabled={busy !== undefined}><Check size={13} />运行质量评估</button><button type="button" className="video-button" onClick={() => void guest.submitUserMessage(`请调用 video_evaluate 评估当前视频工程${project.timeline.outputVideo?.attachmentId === undefined ? "，先输出结构化工程问题" : `，artifact_attachment_id=${project.timeline.outputVideo.attachmentId}`}；返回技术、时间线、连续性、叙事、生成与 MP4 解码证据。`)} disabled={busy !== undefined}><Sparkles size={13} />让 Agent 复核</button></div>
                {qualityReport !== undefined ? <div className={`video-quality-status ${qualityReport.status}`}><strong>{qualityReport.status} · {Math.round(qualityReport.overallScore * 100)} 分</strong><span>{qualityReport.checks.filter((check) => check.status === "fail").length} 项失败 · {qualityReport.checks.filter((check) => check.status === "warn").length} 项警告</span><small>{qualityReport.checks.filter((check) => check.status !== "pass").slice(0, 3).map((check) => check.claim).join("；") || "未发现结构化阻断项"}</small></div> : null}
              </section>
              <section className="video-card" data-video-audio-card>
                <div className="video-label"><span><AudioLines size={14} aria-hidden />音频轨道</span><span>{audioTrack === undefined ? "未设置" : audioTrack.attachmentId}</span></div>
                <div className="video-audio-fields">
                  <label className="video-audio-id"><span className="video-label">音频 attachment id</span><input className="video-input" value={audioAttachmentId} onChange={(event) => setAudioAttachmentId(event.target.value)} placeholder="att_audio…" /></label>
                  <label><span className="video-label">开始秒</span><input className="video-input" inputMode="decimal" value={audioStart} onChange={(event) => setAudioStart(event.target.value)} /></label>
                  <label><span className="video-label">裁剪起点</span><input className="video-input" inputMode="decimal" value={audioTrimStart} onChange={(event) => setAudioTrimStart(event.target.value)} /></label>
                  <label><span className="video-label">裁剪时长</span><input className="video-input" inputMode="decimal" value={audioDuration} onChange={(event) => setAudioDuration(event.target.value)} placeholder="到结尾" /></label>
                  <label><span className="video-label">音量</span><input className="video-input" inputMode="decimal" value={audioVolume} onChange={(event) => setAudioVolume(event.target.value)} /></label>
                  <label><span className="video-label">混音模式</span><select className="video-select" value={audioMode} onChange={(event) => setAudioMode(event.target.value as "replace" | "mix")}><option value="replace">替换原音</option><option value="mix">混合原音</option></select></label>
                </div>
                <div className="video-actions"><button type="button" className="video-button" onClick={() => void applyAudioTrack()} disabled={busy !== undefined}><AudioLines size={13} />设置音轨</button><button type="button" className="video-button" onClick={() => void trimAudio()} disabled={busy !== undefined || audioTrack === undefined}><Pencil size={13} />保存裁剪</button><button type="button" className="video-button" onClick={() => void run("clear-audio-track")} disabled={busy !== undefined || audioTrack === undefined}><Trash2 size={13} />清除音轨</button><button type="button" className="video-button primary" onClick={() => void generateWithAudio()} disabled={busy !== undefined || audioTrack === undefined}><Sparkles size={13} />按音轨生成视频</button></div>
              </section>
              <section className="video-card" data-video-shots>
                <div className="video-label"><span>镜头列表</span><span>{project.shots.length} 镜头 · {shotCount(project, "done")} 个完成</span></div>
                <div className="video-shot-list">{project.shots.map((shot) => {
                  const editing = editingShotId === shot.id;
                  return <article key={shot.id} className={`video-shot ${shot.id === selectedShot?.id ? "active" : ""}`} data-video-shot={shot.id} onClick={() => setSelectedShotId(shot.id)}>
                    <span className="video-shot-number">{shot.index}</span>
                    <div className="video-shot-content">
                      <div className="video-shot-title">{shot.title}</div>
                      <p className="video-shot-prompt">{shot.prompt}</p>
                      <div className="video-history-block"><div className="video-history-title">提示词历史 · {shot.promptHistory.length}</div>{shot.promptHistory.map((version) => <div className={`video-history-row ${version.id === shot.activePromptId ? "current" : ""}`} key={version.id}><button type="button" className="video-history-prompt" title={version.prompt} onClick={(event) => { event.stopPropagation(); void run("select-prompt", { shotId: shot.id, promptId: version.id }); }}>{version.source} · {timestamp(version.createdAt)} · {version.prompt}</button><button type="button" className="video-icon-button" aria-label="删除提示词历史" title="删除提示词版本" onClick={(event) => { event.stopPropagation(); void run("delete-prompt-history", { shotId: shot.id, promptId: version.id }); }}><Trash2 size={11} /></button></div>)}</div>
                      <div className="video-history-block"><div className="video-history-title">视频历史 · {shot.videoHistory.length}</div>{shot.videoHistory.length === 0 ? <span className="video-muted">暂无生成版本</span> : shot.videoHistory.map((video) => <div className={`video-history-row ${video.attachmentId === shot.attachmentId ? "current" : ""}`} key={video.id}><button type="button" className="video-history-asset" onClick={(event) => { event.stopPropagation(); void run("select-video", { shotId: shot.id, videoId: video.id }); }}>{video.attachmentId ?? video.previewUrl ?? video.id}</button><span>{timestamp(video.createdAt)}</span><button type="button" className="video-icon-button" aria-label="加入视频轨道" title="加入视频轨道" onClick={(event) => { event.stopPropagation(); void run("add-to-timeline", { shotId: shot.id, videoId: video.id }); }}><Plus size={11} /></button><button type="button" className="video-icon-button" aria-label="删除视频历史" title="删除视频版本" onClick={(event) => { event.stopPropagation(); void run("delete-video-history", { shotId: shot.id, videoId: video.id }); }}><Trash2 size={11} /></button></div>)}</div>
                    </div>
                    <div className="video-shot-controls"><span className={`video-shot-badge ${shot.status}`}>{STATUS_LABEL[shot.status]}</span><button type="button" className="video-button" onClick={(event) => { event.stopPropagation(); void startShot(shot); }} disabled={busy !== undefined || shot.status === "generating" || shot.status === "queued"}><Play size={13} />发送至 Agent 生成</button>{shot.status === "queued" || shot.status === "generating" ? <button type="button" className="video-icon-button" aria-label="暂停生成" title="暂停" onClick={(event) => { event.stopPropagation(); void run("pause-shot", { shotId: shot.id }); }}><Pause size={13} /></button> : null}<button type="button" className="video-icon-button" aria-label="重新生成提示词" title="重新生成提示词" onClick={(event) => { event.stopPropagation(); void regeneratePrompt(shot); }}><Sparkles size={13} /></button><button type="button" className="video-icon-button" aria-label="编辑镜头" title="编辑" onClick={(event) => { event.stopPropagation(); beginEdit(shot); }}><Pencil size={13} /></button>{shot.status === "failed" ? <button type="button" className="video-icon-button" aria-label="重试生成" title="重试" onClick={(event) => { event.stopPropagation(); void startShot(shot); }}><RotateCcw size={13} /></button> : null}</div>
                    {editing ? <div className="video-edit" onClick={(event) => event.stopPropagation()}><textarea className="video-textarea" value={editPrompt} onChange={(event) => setEditPrompt(event.target.value)} /><div className="video-actions"><button type="button" className="video-button primary" onClick={() => void saveEdit(shot)}><Check size={13} />保存新版本</button><button type="button" className="video-button" onClick={() => setEditingShotId(undefined)}>取消</button><button type="button" className="video-button" onClick={() => void regeneratePrompt(shot)}><Sparkles size={13} />让 Agent 重写</button></div></div> : null}
                    <div className="video-shot-progress"><span style={{ width: `${shot.progress}%` }} /></div>
                  </article>;
                })}</div>
                <div className="video-actions"><button type="button" className="video-button primary" data-video-auto-generate onClick={() => void autoGenerate()} disabled={busy !== undefined || project.shots.length === 0}><Loader2 size={14} className={busy === "queue-all" ? "spin" : undefined} />自动生成首版</button><button type="button" className="video-button" data-video-export onClick={() => void requestExport()} disabled={busy !== undefined || project.shots.some((shot) => shot.status !== "done") || project.timeline.videoClips.length === 0}><Download size={14} />导出合成</button></div>
              </section>
            </>
          )}
          {project !== null && editingBrief ? <section className="video-card" data-video-edit-brief><h3>编辑项目简报</h3><textarea className="video-textarea" value={brief} onChange={(event) => setBrief(event.target.value)} /><div className="video-fields"><label><span className="video-label">项目名</span><input className="video-input" value={title} onChange={(event) => setTitle(event.target.value)} /></label><label><span className="video-label">画幅</span><select className="video-select" value={aspectRatio} onChange={(event) => setAspectRatio(event.target.value as VideoProject["aspectRatio"])}><option value="16:9">横版 16:9</option><option value="9:16">竖版 9:16</option><option value="1:1">方形 1:1</option></select></label><label><span className="video-label">自动化</span><select className="video-select" value={automation} onChange={(event) => setAutomation(event.target.value as VideoAutomation)}><option value="manual">手动</option><option value="assisted">协作</option><option value="automatic">自动</option></select></label></div><div className="video-actions"><button type="button" className="video-button primary" onClick={() => void saveBrief()} disabled={busy !== undefined || brief.trim() === ""}><Check size={13} />保存简报</button><button type="button" className="video-button" onClick={() => setEditingBrief(false)}>取消</button></div></section> : null}
        </main>
        <aside className="video-sidebar">
          {project !== null ? <><section className="video-card"><h3>{project.title}</h3><p className="video-muted">{project.brief}</p><div className="video-kpi"><div><strong>{project.shots.length}</strong><span>镜头</span></div><div><strong>{shotCount(project, "done")}</strong><span>完成</span></div><div><strong>{project.timeline.videoClips.length}</strong><span>入轨</span></div></div><div className="video-actions"><button type="button" className="video-button" onClick={() => { setBrief(project.brief); setTitle(project.title); setAspectRatio(project.aspectRatio); setAutomation(project.automation); setEditingBrief(true); }}><Pencil size={13} />编辑简报</button></div></section><section className="video-card"><h3>实时控制</h3><p className="video-muted">Agent 执行于对话外部状态面；人可随时暂停、改稿、重试、回滚，历史直到手动删除。</p><div className="video-actions"><button type="button" className="video-button" onClick={() => selectedShot !== undefined && void run("rollback-shot", { shotId: selectedShot.id })} disabled={selectedShot === undefined}><RotateCcw size={13} />回滚当前镜头</button><button type="button" className="video-button" onClick={() => selectedShot !== undefined && void submitShot(selectedShot, "stage")} disabled={selectedShot === undefined}><Send size={13} />暂存完整生成请求</button></div></section><section className="video-card"><h3>事件记录</h3><div className="video-event-list">{state.events.length === 0 ? <span className="video-muted">暂无事件</span> : [...state.events].reverse().slice(0, 12).map((event) => <div className="video-event" key={event.id}><time>{timestamp(event.at)}</time>{event.message}</div>)}</div></section></> : <section className="video-empty"><div><Sparkles size={23} aria-hidden /><p>先写一段创意简报<br />Agent 会拆成可执行镜头并返回这里</p></div></section>}
        </aside>
      </div>
    </div>
  );
}

installVideoStudioStyles();
const root = document.getElementById("root");
if (root !== null) {
  createRoot(root).render(<PaneGuestProvider paneId="video-studio"><VideoStudioApp /></PaneGuestProvider>);
}

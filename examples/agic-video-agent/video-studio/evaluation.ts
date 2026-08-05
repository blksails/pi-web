/** 视频质量评估：只报告有证据的结构/技术事实，不冒充视觉模型打分。 */
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import type { VideoProject } from "./model.js";

export const VIDEO_QUALITY_SCHEMA_VERSION = 1;

export type VideoQualityDimension = "technical" | "timeline" | "continuity" | "narrative" | "generation" | "artifact";
export type VideoQualityStatus = "pass" | "warn" | "fail";

export interface VideoQualityCheck {
  readonly id: string;
  readonly dimension: VideoQualityDimension;
  readonly status: VideoQualityStatus;
  readonly score: number;
  readonly confidence: number;
  readonly claim: string;
  readonly evidence: readonly string[];
  readonly blocking: boolean;
  readonly affectedNodeIds: readonly string[];
}

export interface VideoQualityReport {
  readonly schemaVersion: number;
  readonly projectId: string;
  readonly artifactAttachmentId?: string;
  readonly overallScore: number;
  readonly status: VideoQualityStatus;
  readonly blockingFindings: readonly string[];
  readonly checks: readonly VideoQualityCheck[];
  readonly unresolved: readonly string[];
}

function statusFor(score: number): VideoQualityStatus {
  return score >= 0.8 ? "pass" : score >= 0.5 ? "warn" : "fail";
}

function check(
  id: string,
  dimension: VideoQualityDimension,
  score: number,
  confidence: number,
  claim: string,
  evidence: readonly string[],
  blocking: boolean,
  affectedNodeIds: readonly string[] = [],
): VideoQualityCheck {
  return { id, dimension, score: Math.max(0, Math.min(1, score)), status: statusFor(score), confidence, claim, evidence, blocking, affectedNodeIds };
}

function report(project: VideoProject, checks: readonly VideoQualityCheck[], artifactAttachmentId?: string): VideoQualityReport {
  const overallScore = checks.length === 0 ? 0 : checks.reduce((sum, item) => sum + item.score, 0) / checks.length;
  const blockingFindings = checks.filter((item) => item.blocking && item.status === "fail").map((item) => item.claim);
  return {
    schemaVersion: VIDEO_QUALITY_SCHEMA_VERSION,
    projectId: project.id,
    ...(artifactAttachmentId === undefined ? {} : { artifactAttachmentId }),
    overallScore: Math.round(overallScore * 100) / 100,
    status: blockingFindings.length > 0 ? "fail" : statusFor(overallScore),
    blockingFindings,
    checks,
    unresolved: checks.filter((item) => item.status !== "pass").map((item) => item.claim),
  };
}

export function evaluateVideoProject(project: VideoProject): VideoQualityReport {
  const totalShotDuration = project.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
  const durationDelta = Math.abs(totalShotDuration - project.targetDurationSec) / Math.max(1, project.targetDurationSec);
  const unfinished = project.shots.filter((shot) => shot.status !== "done").map((shot) => `shot:${shot.id}`);
  const checks: VideoQualityCheck[] = [
    check("technical-project", "technical", project.shots.length > 0 && project.targetDurationSec > 0 ? 1 : 0, 0.99, "项目包含有效镜头与目标时长", ["project.shots", "project.targetDurationSec"], true),
    check("timeline-duration", "timeline", durationDelta <= 0.25 ? 1 : 0.45, 0.95, durationDelta <= 0.25 ? "镜头总时长与目标时长接近" : "镜头总时长偏离目标时长", [`sum=${totalShotDuration}`, `target=${project.targetDurationSec}`], false, unfinished),
    check("continuity-coverage", "continuity", project.transitions.length >= Math.max(0, project.shots.length - 1) && project.continuity.length >= Math.max(0, project.shots.length - 1) ? 1 : 0.4, 0.9, "相邻镜头具有转场与连续性记录", [`transitions=${project.transitions.length}`, `continuity=${project.continuity.length}`], false),
    check("narrative-evidence", "narrative", project.brief.trim() !== "" && project.scenes.length > 0 ? 0.7 : 0.35, 0.75, "叙事结构具项目简报与场景骨架；语义质量仍需人工/模型复核", ["project.brief", `scenes=${project.scenes.length}`], false),
    check("generation-completeness", "generation", unfinished.length === 0 ? 1 : 0.5, 0.99, unfinished.length === 0 ? "全部镜头已有完成状态" : `仍有 ${unfinished.length} 个镜头未完成生成`, [`done=${project.shots.length - unfinished.length}`, `total=${project.shots.length}`], false, unfinished),
  ];
  return report(project, checks);
}

function decodeVideo(path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-v", "error", "-i", path, "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-1000) || `ffmpeg exited ${code ?? "unknown"}`)));
  });
}

export async function evaluateRenderedVideo(
  project: VideoProject,
  artifactAttachmentId: string,
  localPath: string,
): Promise<VideoQualityReport> {
  const checks = [...evaluateVideoProject(project).checks];
  try {
    const file = await stat(localPath);
    if (file.size === 0) throw new Error("MP4 文件为空");
    await decodeVideo(localPath);
    checks.push(check("artifact-decode", "artifact", 1, 0.99, "MP4 文件可由 FFmpeg 解码", [`bytes=${file.size}`, "ffmpeg decode exit=0"], true));
  } catch (error) {
    checks.push(check("artifact-decode", "artifact", 0, 0.99, `MP4 文件不可解码：${error instanceof Error ? error.message : String(error)}`, ["ffmpeg decode"], true));
  }
  return report(project, checks, artifactAttachmentId);
}

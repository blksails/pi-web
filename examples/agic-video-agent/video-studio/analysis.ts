/** 视频拆解契约：分析结果可审计、可修正、可复用，不绑定具体模型或渲染器。 */

export const VIDEO_ANALYSIS_SCHEMA_VERSION = 1;

export type VideoAnalysisStatus = "partial" | "complete" | "failed";
export type VideoAnalysisEvidenceSource = "metadata" | "frame" | "interval" | "audio" | "agent" | "manual";
export type VideoAnalysisCorrectionAuthor = "user" | "agent";

export interface VideoAnalysisEvidence {
  readonly id: string;
  readonly source: VideoAnalysisEvidenceSource;
  readonly claim: string;
  readonly confidence: number;
  readonly startSec?: number;
  readonly endSec?: number;
  readonly frameNumber?: number;
  readonly locator?: string;
}

export interface VideoAnalysisFact {
  readonly id: string;
  readonly category: string;
  readonly claim: string;
  readonly value: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
}

export interface VideoTechnicalAnalysis {
  readonly facts: readonly VideoAnalysisFact[];
  readonly durationSec?: number;
  readonly width?: number;
  readonly height?: number;
  readonly fps?: number;
  readonly codec?: string;
  readonly hasAudio?: boolean;
}

export interface VideoTimelineSegment {
  readonly id: string;
  readonly startSec: number;
  readonly endSec: number;
  readonly label: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly shotIndex?: number;
  readonly transitionHint?: string;
}

export interface VideoTimelineAnalysis {
  readonly facts: readonly VideoAnalysisFact[];
  readonly segments: readonly VideoTimelineSegment[];
}

export interface VideoVisualAnalysis {
  readonly facts: readonly VideoAnalysisFact[];
  readonly subjects: readonly string[];
  readonly cameraLanguage?: string;
  readonly palette?: readonly string[];
  readonly style?: string;
}

export interface VideoNarrativeBeat {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly confidence: number;
  readonly evidenceIds: readonly string[];
  readonly segmentId?: string;
}

export interface VideoNarrativeAnalysis {
  readonly facts: readonly VideoAnalysisFact[];
  readonly logline?: string;
  readonly beats: readonly VideoNarrativeBeat[];
  readonly characters: readonly string[];
  readonly locations: readonly string[];
  readonly tone?: string;
}

export interface VideoGenerationAnalysis {
  readonly facts: readonly VideoAnalysisFact[];
  readonly prompt?: string;
  readonly negativePrompt?: string;
  readonly modelHints: readonly string[];
  readonly sourceAssets: readonly string[];
  readonly unavailable: readonly string[];
}

export interface VideoAnalysisCorrection {
  readonly id: string;
  readonly target: string;
  readonly before: string;
  readonly after: string;
  readonly reason: string;
  readonly author: VideoAnalysisCorrectionAuthor;
  readonly at: string;
}

export interface VideoAnalysisResult {
  readonly schemaVersion: number;
  readonly id: string;
  readonly sourceAttachmentId: string;
  readonly status: VideoAnalysisStatus;
  readonly createdAt: string;
  readonly technical: VideoTechnicalAnalysis;
  readonly timeline: VideoTimelineAnalysis;
  readonly visual: VideoVisualAnalysis;
  readonly narrative: VideoNarrativeAnalysis;
  readonly generation: VideoGenerationAnalysis;
  readonly evidence: readonly VideoAnalysisEvidence[];
  readonly corrections: readonly VideoAnalysisCorrection[];
  readonly unresolved: readonly string[];
}

export interface VideoAnalysisValidationResult {
  readonly ok: boolean;
  readonly value?: VideoAnalysisResult;
  readonly errors: readonly string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function confidence(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function validEvidenceSource(value: unknown): value is VideoAnalysisEvidenceSource {
  return value === "metadata" || value === "frame" || value === "interval" || value === "audio" || value === "agent" || value === "manual";
}

function validCorrectionAuthor(value: unknown): value is VideoAnalysisCorrectionAuthor {
  return value === "user" || value === "agent";
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validateEvidence(value: unknown, errors: string[]): value is VideoAnalysisEvidence[] {
  if (!Array.isArray(value)) {
    errors.push("analysis.evidence 必须为数组");
    return false;
  }
  const ids = new Set<string>();
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !text(item.id) || ids.has(item.id) || !validEvidenceSource(item.source) || !text(item.claim) || !confidence(item.confidence)) {
      errors.push(`analysis.evidence[${index}] 结构或 confidence 无效`);
      continue;
    }
    ids.add(item.id);
    if (item.startSec !== undefined && (typeof item.startSec !== "number" || item.startSec < 0)) errors.push(`analysis.evidence[${index}].startSec 无效`);
    if (item.endSec !== undefined && (typeof item.endSec !== "number" || item.endSec < (typeof item.startSec === "number" ? item.startSec : 0))) errors.push(`analysis.evidence[${index}].endSec 无效`);
  }
  return true;
}

function validateCorrections(value: unknown, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push("analysis.corrections 必须为数组");
    return;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !text(item.id) || !text(item.target) || typeof item.before !== "string" || typeof item.after !== "string" || !text(item.reason) || !validCorrectionAuthor(item.author) || !text(item.at)) {
      errors.push(`analysis.corrections[${index}] 结构无效`);
    }
  }
}

function validateFacts(value: unknown, evidenceIds: ReadonlySet<string>, path: string, errors: string[]): boolean {
  if (!Array.isArray(value)) {
    errors.push(`${path}.facts 必须为数组`);
    return false;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !text(item.id) || !text(item.category) || !text(item.claim) || typeof item.value !== "string" || !confidence(item.confidence) || !stringArray(item.evidenceIds)) {
      errors.push(`${path}.facts[${index}] 结构无效`);
      continue;
    }
    if (item.evidenceIds.some((id) => !evidenceIds.has(id))) errors.push(`${path}.facts[${index}] 引用了不存在的 evidence`);
  }
  return true;
}

function validateSegments(value: unknown, evidenceIds: ReadonlySet<string>, errors: string[]): boolean {
  if (!Array.isArray(value)) {
    errors.push("analysis.timeline.segments 必须为数组");
    return false;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !text(item.id) || typeof item.startSec !== "number" || typeof item.endSec !== "number" || item.startSec < 0 || item.endSec <= item.startSec || !text(item.label) || !confidence(item.confidence) || !stringArray(item.evidenceIds)) {
      errors.push(`analysis.timeline.segments[${index}] 结构无效`);
      continue;
    }
    if (item.evidenceIds.some((id) => !evidenceIds.has(id))) errors.push(`analysis.timeline.segments[${index}] 引用了不存在的 evidence`);
  }
  return true;
}

function validateBeats(value: unknown, evidenceIds: ReadonlySet<string>, errors: string[]): boolean {
  if (!Array.isArray(value)) {
    errors.push("analysis.narrative.beats 必须为数组");
    return false;
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !text(item.id) || !text(item.label) || !text(item.summary) || !confidence(item.confidence) || !stringArray(item.evidenceIds)) {
      errors.push(`analysis.narrative.beats[${index}] 结构无效`);
      continue;
    }
    if (item.evidenceIds.some((id) => !evidenceIds.has(id))) errors.push(`analysis.narrative.beats[${index}] 引用了不存在的 evidence`);
  }
  return true;
}

export function validateVideoAnalysis(value: unknown): VideoAnalysisValidationResult {
  if (!isRecord(value)) return { ok: false, errors: ["analysis 必须为对象"] };
  const errors: string[] = [];
  if (value.schemaVersion !== VIDEO_ANALYSIS_SCHEMA_VERSION) errors.push(`analysis.schemaVersion 必须为 ${VIDEO_ANALYSIS_SCHEMA_VERSION}`);
  if (!text(value.id) || !text(value.sourceAttachmentId) || !text(value.status) || !text(value.createdAt)) errors.push("analysis 的身份字段无效");
  if (value.status !== "partial" && value.status !== "complete" && value.status !== "failed") errors.push("analysis.status 无效");
  const validEvidence = validateEvidence(value.evidence, errors);
  const evidenceIds = new Set(validEvidence && Array.isArray(value.evidence) ? value.evidence.filter(isRecord).map((item) => item.id).filter(text) : []);
  for (const section of ["technical", "timeline", "visual", "narrative", "generation"] as const) {
    if (!isRecord(value[section])) errors.push(`analysis.${section} 必须为对象`);
    else validateFacts(value[section].facts, evidenceIds, `analysis.${section}`, errors);
  }
  if (isRecord(value.timeline)) validateSegments(value.timeline.segments, evidenceIds, errors);
  if (isRecord(value.narrative)) {
    validateBeats(value.narrative.beats, evidenceIds, errors);
    if (!stringArray(value.narrative.characters) || !stringArray(value.narrative.locations)) errors.push("analysis.narrative 的 characters/locations 无效");
  }
  if (isRecord(value.visual) && (!stringArray(value.visual.subjects) || (value.visual.palette !== undefined && !stringArray(value.visual.palette)))) errors.push("analysis.visual 的 subjects/palette 无效");
  if (isRecord(value.generation) && (!stringArray(value.generation.modelHints) || !stringArray(value.generation.sourceAssets) || !stringArray(value.generation.unavailable))) errors.push("analysis.generation 的数组字段无效");
  validateCorrections(value.corrections, errors);
  if (!stringArray(value.unresolved)) errors.push("analysis.unresolved 必须为字符串数组");
  return errors.length === 0 ? { ok: true, value: value as unknown as VideoAnalysisResult, errors: [] } : { ok: false, errors };
}

export function normalizeVideoAnalysis(value: unknown): VideoAnalysisResult | null {
  const validation = validateVideoAnalysis(value);
  return validation.ok ? validation.value ?? null : null;
}

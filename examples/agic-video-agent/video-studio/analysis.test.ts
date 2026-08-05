import test from "node:test";
import assert from "node:assert/strict";
import { validateVideoAnalysis } from "./analysis.js";

interface TestAnalysis {
  readonly [key: string]: unknown;
  readonly timeline: { readonly facts: readonly unknown[]; readonly segments: Array<{ readonly id: string; readonly startSec: number; readonly endSec: number; readonly label: string; readonly confidence: number; evidenceIds: string[] }> };
  corrections: Array<Record<string, unknown>>;
}

function validAnalysis(): TestAnalysis {
  return {
    schemaVersion: 1,
    id: "analysis-test",
    sourceAttachmentId: "att_video",
    status: "partial",
    createdAt: "2026-08-05T00:00:00.000Z",
    technical: { facts: [] },
    timeline: { facts: [], segments: [{ id: "segment-1", startSec: 0, endSec: 2, label: "开场", confidence: 0.8, evidenceIds: ["frame-1"] }] },
    visual: { facts: [], subjects: ["主体"] },
    narrative: { facts: [], beats: [], characters: [], locations: [] },
    generation: { facts: [], modelHints: [], sourceAssets: [], unavailable: ["原始 seed"] },
    evidence: [{ id: "frame-1", source: "frame", claim: "开场画面", confidence: 0.8, frameNumber: 0 }],
    corrections: [],
    unresolved: ["生成模型不可恢复"],
  };
}

test("analysis accepts partial evidence-backed decomposition", () => {
  const result = validateVideoAnalysis(validAnalysis());
  assert.equal(result.ok, true);
  assert.equal(result.value?.timeline.segments[0]?.evidenceIds[0], "frame-1");
});

test("analysis rejects orphan evidence references and invalid correction author", () => {
  const value = validAnalysis();
  value.timeline.segments[0]!.evidenceIds = ["missing"];
  value.corrections = [{ id: "c-1", target: "visual.style", before: "", after: "film", reason: "人工修正", author: "operator", at: "2026-08-05T00:00:00.000Z" }];
  const result = validateVideoAnalysis(value);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes("不存在的 evidence")));
  assert.ok(result.errors.some((error) => error.includes("corrections")));
});

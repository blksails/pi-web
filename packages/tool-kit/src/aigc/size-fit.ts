/**
 * 出图尺寸适配(对标 pi-labs `lib/aigc/size-fit.ts`)。无 IO。
 *
 * 生图前:已是 16 步进则原样发给模型;否则映射到合法尺寸。
 * 生图后由 fit 裁/缩放回任意 W×H。
 * 例:1080x1920 不是 16 倍 → 模型收 576x1024,落盘后再缩放回 1080x1920。
 */

export type Size = { w: number; h: number };

export type SizeConstraint = {
  minW: number;
  maxW: number;
  minH: number;
  maxH: number;
  stepW: number;
  stepH: number;
};

export const GEN_TARGET_EDGE = 1024;
export const GEN_STEP = 16;
export const MAX_OUTPUT_EDGE = 4096;

export const DEFAULT_SIZE_CONSTRAINT: SizeConstraint = {
  minW: 256,
  maxW: 2048,
  minH: 256,
  maxH: 2048,
  stepW: GEN_STEP,
  stepH: GEN_STEP,
};

export function parseSize(s: string): Size | null {
  const m = /^\s*(\d+)\s*[*x×]\s*(\d+)\s*$/i.exec(s);
  if (!m) return null;
  const w = Number.parseInt(m[1]!, 10);
  const h = Number.parseInt(m[2]!, 10);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

export function formatSize(s: Size, sep: "x" | "*" = "x"): string {
  return `${s.w}${sep}${s.h}`;
}

const RATIO_PRESETS: Record<string, Size> = {
  "1:1": { w: 1024, h: 1024 },
  "9:16": { w: 720, h: 1280 },
  "16:9": { w: 1280, h: 720 },
  "3:4": { w: 864, h: 1152 },
  "4:3": { w: 1152, h: 864 },
  "2:3": { w: 832, h: 1248 },
  "3:2": { w: 1248, h: 832 },
};

export function ratioToSize(s: string): Size | null {
  const m = /^\s*(\d{1,2})\s*[:：]\s*(\d{1,2})\s*$/.exec(s);
  if (!m) return null;
  const key = `${Number.parseInt(m[1]!, 10)}:${Number.parseInt(m[2]!, 10)}`;
  if (RATIO_PRESETS[key]) return RATIO_PRESETS[key]!;
  const a = Number.parseInt(m[1]!, 10);
  const b = Number.parseInt(m[2]!, 10);
  if (!(a > 0) || !(b > 0)) return null;
  const scale = 1280 / Math.max(a, b);
  const snap = (v: number): number => Math.max(16, Math.round((v * scale) / 16) * 16);
  return { w: snap(a), h: snap(b) };
}

export function resolveUserSize(s: string): Size | null {
  return parseSize(s) ?? ratioToSize(s);
}

export function sizeEq(a: Size, b: Size): boolean {
  return a.w === b.w && a.h === b.h;
}

export function isLegal(s: Size, c: SizeConstraint): boolean {
  return (
    s.w >= c.minW &&
    s.w <= c.maxW &&
    s.h >= c.minH &&
    s.h <= c.maxH &&
    c.stepW > 0 &&
    c.stepH > 0 &&
    s.w % c.stepW === 0 &&
    s.h % c.stepH === 0
  );
}

export function snapToAllowedSize(userSize: string, allowed: string[]): string {
  const m = /^(\d+)\s*[*x×]\s*(\d+)$/i.exec(userSize);
  if (!m) return userSize;
  const tw = Number.parseInt(m[1]!, 10);
  const th = Number.parseInt(m[2]!, 10);
  if (!(tw > 0) || !(th > 0) || allowed.length === 0) return userSize;
  const tr = tw / th;
  let best = allowed[0]!;
  let bestScore = Infinity;
  for (const s of allowed) {
    const [w, h] = s.split(/[*x×]/i).map(Number);
    if (!w || !h) continue;
    const ratioDiff = Math.abs(w / h - tr);
    let score = ratioDiff * 1_000_000 + w * h;
    if (w === tw && h === th) score = -1;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

function snapToStep(v: number, step: number, min: number, max: number): number {
  if (step <= 0) return Math.min(Math.max(Math.round(v), min), max);
  let x = Math.round(v / step) * step;
  const lo = Math.ceil(min / step) * step;
  const hi = Math.floor(max / step) * step;
  if (x < lo) x = lo;
  if (x > hi) x = hi;
  return x;
}

export function planGenSize(
  target: Size,
  c: SizeConstraint = DEFAULT_SIZE_CONSTRAINT,
  genEdge: number = GEN_TARGET_EDGE,
): Size {
  const longest = Math.max(target.w, target.h);
  const shrink = Math.min(1, genEdge / longest);
  let w = target.w * shrink;
  let h = target.h * shrink;
  const up = Math.max(1, c.minW / w, c.minH / h);
  w *= up;
  h *= up;
  const down = Math.min(1, c.maxW / w, c.maxH / h);
  w *= down;
  h *= down;
  return {
    w: snapToStep(w, c.stepW, c.minW, c.maxW),
    h: snapToStep(h, c.stepH, c.minH, c.maxH),
  };
}

export function clampOutputTarget(target: Size, maxEdge: number = MAX_OUTPUT_EDGE): Size {
  const longest = Math.max(target.w, target.h);
  if (longest <= maxEdge) return target;
  const s = maxEdge / longest;
  return { w: Math.max(1, Math.round(target.w * s)), h: Math.max(1, Math.round(target.h * s)) };
}

export type FitMode = "skip" | "cover" | "contain";

export function planGeometry(actual: Size, target: Size): FitMode {
  if (sizeEq(actual, target)) return "skip";
  if (Math.abs(actual.w / actual.h - target.w / target.h) < 0.001) return "contain";
  return "cover";
}

/**
 * 用户尺寸 → 发给模型的合法尺寸 + 最终输出目标。
 * auto / 无法解析 → undefined(不改 args)。
 */
export function planModelAndTargetSize(
  raw: string,
  constraint: SizeConstraint = DEFAULT_SIZE_CONSTRAINT,
): { modelSize: Size; targetSize: Size } | undefined {
  if (raw.trim() === "" || raw.trim().toLowerCase() === "auto" || raw.trim().toLowerCase() === "custom") {
    return undefined;
  }
  const parsed = resolveUserSize(raw);
  if (parsed === null) return undefined;
  const targetSize = clampOutputTarget(parsed);
  if (isLegal(targetSize, constraint)) return { modelSize: targetSize, targetSize };
  return { modelSize: planGenSize(targetSize, constraint), targetSize };
}

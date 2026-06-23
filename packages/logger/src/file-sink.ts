/**
 * @pi-web/logger — Node file-output sink
 *
 * Writes log entries as JSONL lines to a local file, with optional rotation
 * when the file exceeds `maxSizeMb`.  Rotation scheme:
 *
 *   app.log       — current (active) log file
 *   app.log.1     — most recent backup (created on rotation)
 *   app.log.2     — next older backup
 *   …
 *   app.log.N     — oldest kept backup (N = maxFiles)
 *
 * On rotation the existing backups are shifted up by one (.1 → .2, etc.),
 * the active file is renamed to .1, and a fresh active file is started.
 * Backups beyond `maxFiles` are deleted.
 *
 * ISOMORPHIC SAFETY (Requirement 1.6)
 * ------------------------------------
 * This module MUST NOT use any static OR dynamic import of any built-in
 * specifier (e.g. "node:fs", "node:path") so that webpack / Next.js client
 * builds never attempt to resolve Node built-ins.
 *
 *   1.  The `fs` module reference is read from `globalThis.__PI_WEB_FS__`,
 *       a seam populated exclusively by the Node-only runner bootstrap
 *       (packages/server/src/runner/runner.ts) before the first log call.
 *   2.  In browser environments the seam is never set, so `getFsRef()`
 *       always returns null and every sink call is a silent no-op.
 *   3.  No built-in specifier string appears anywhere in this file — neither
 *       as a static import nor as a dynamic expression.
 *
 * Write and rotation failures are silently swallowed (Requirement 7.4) — a
 * log sink must never crash or surface errors to the agent session.
 */

import type { LogEntry, Sink } from "./types.js";

// ── File output configuration ─────────────────────────────────────────────

export interface FileOutputConfig {
  /** Whether file output is active. When false the sink is a no-op. */
  enabled: boolean;
  /** Absolute (or resolvable) path to the active log file. */
  path: string;
  /** Rotation threshold in megabytes. Rotation occurs *before* writing when
   *  the current file already exceeds this size. */
  maxSizeMb: number;
  /** Maximum number of rotated backup files to keep (.1 … .N).
   *  Backups beyond this count are deleted during rotation. */
  maxFiles: number;
}

// ── globalThis seam keys ───────────────────────────────────────────────────
//
// We read the resolved `fs` module from `globalThis` under a private key.
// The seam is populated by the Node-only runner entry before any logger call
// (see packages/server/src/runner/runner.ts — startRunner fills __PI_WEB_FS__
// via a plain dynamic import that never reaches the browser bundle).
// This file itself must contain ZERO references to any "node:" specifier so
// that webpack / Next.js client builds never attempt to resolve Node built-ins.

const FS_SEAM_KEY = "__PI_WEB_FS__";

// Type alias for the subset of the fs API we actually use.
// (No "node:" specifier here — this is just a structural interface.)
interface FsSubset {
  existsSync(p: string): boolean;
  statSync(p: string): { size: number };
  renameSync(oldPath: string, newPath: string): void;
  unlinkSync(p: string): void;
  appendFileSync(p: string, data: string, enc: string): void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Globals = Record<string, any>;

/**
 * Return the `fs` reference previously placed on `globalThis.__PI_WEB_FS__`
 * by the Node-only runner bootstrap, or null if it is not available.
 *
 * This function performs NO dynamic imports — it only reads globalThis.
 * In browser environments the seam is never populated, so this always
 * returns null and the sink is a no-op.
 */
function getFsRef(): FsSubset | null {
  const g = globalThis as Globals;
  const ref = g[FS_SEAM_KEY];
  return ref != null ? (ref as FsSubset) : null;
}

// ── Rotation helper ────────────────────────────────────────────────────────

/**
 * Rotate log files: active → .1, .1 → .2, …, .(maxFiles-1) → .maxFiles.
 * Files at index maxFiles are deleted to avoid unbounded growth.
 */
function rotate(fs: FsSubset, filePath: string, maxFiles: number): void {
  // Iterate from the highest index downward so we don't clobber files
  // before moving them.
  for (let i = maxFiles; i >= 1; i--) {
    const dest = `${filePath}.${i}`;
    const src = i === 1 ? filePath : `${filePath}.${i - 1}`;

    // Delete dest if it exists (makes room).
    try {
      if (i === maxFiles && fs.existsSync(dest)) {
        fs.unlinkSync(dest);
      }
    } catch {
      /* swallow */
    }

    // Move src → dest.
    try {
      if (fs.existsSync(src)) {
        fs.renameSync(src, dest);
      }
    } catch {
      /* swallow */
    }
  }
}

// ── createFileSink ────────────────────────────────────────────────────────

/**
 * Create a file-output Sink from the supplied configuration.
 *
 * The returned sink is synchronous from the caller's perspective.  Each call
 * appends one JSON line to the configured path, rotating first if the active
 * file has reached `maxSizeMb`.
 *
 * All errors (open, write, rotation) are caught and swallowed (R7.4).
 */
export function createFileSink(config: FileOutputConfig): Sink {
  if (!config.enabled) {
    // Disabled path — return a pure no-op; never touch fs.
    return () => { /* no-op */ };
  }

  return (entry: LogEntry): void => {
    try {
      const fs = getFsRef();
      // If Node modules aren't loaded yet (or environment is not Node) → skip.
      if (!fs) return;

      const line = JSON.stringify(entry) + "\n";
      const filePath = config.path;
      const maxBytes = config.maxSizeMb * 1024 * 1024;

      // Check if rotation is needed (current file exceeds size limit).
      if (fs.existsSync(filePath)) {
        try {
          const stat = fs.statSync(filePath);
          if (stat.size >= maxBytes) {
            rotate(fs, filePath, config.maxFiles);
          }
        } catch {
          // statSync failure → skip rotation check, still try to write
        }
      }

      // Append log line to the active file.
      fs.appendFileSync(filePath, line, "utf8");
    } catch {
      // R7.4: All write/rotation errors are swallowed — must not crash session.
    }
  };
}

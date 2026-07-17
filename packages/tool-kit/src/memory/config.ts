/**
 * Memory backend config from environment + factory.
 */

import { homedir } from "node:os";
import path from "node:path";
import { FileMemoryStore } from "./file-store.js";
import { SupabaseMemoryStore } from "./supabase-store.js";
import type { MemoryStore } from "./types.js";

export type MemoryBackendKind = "file" | "supabase";

export interface MemoryConfig {
  readonly backend: MemoryBackendKind;
  readonly dir: string;
  readonly supabaseUrl?: string;
  readonly supabaseKey?: string;
  readonly supabaseTable: string;
  /** Default agent source id for tools when not passed per-call. */
  readonly defaultAgentSourceId?: string;
}

export class MemoryConfigError extends Error {
  readonly code = "BACKEND_CONFIG" as const;
  constructor(message: string) {
    super(message);
    this.name = "MemoryConfigError";
  }
}

function defaultMemoryDir(): string {
  return path.join(homedir(), ".pi", "agent", "memory");
}

/**
 * Parse memory config from an env map (defaults to process.env).
 * Fail-fast on unknown backend or incomplete supabase credentials.
 */
export function memoryConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): MemoryConfig {
  const raw = (env.PI_WEB_MEMORY_BACKEND ?? "file").trim().toLowerCase();
  if (raw !== "file" && raw !== "supabase") {
    throw new MemoryConfigError(
      `unknown PI_WEB_MEMORY_BACKEND=${JSON.stringify(raw)}; expected "file" | "supabase"`,
    );
  }
  const dir = (env.PI_WEB_MEMORY_DIR?.trim() || defaultMemoryDir());
  const supabaseTable =
    env.PI_WEB_MEMORY_SUPABASE_TABLE?.trim() || "pi_web_memories";
  const defaultAgentSourceId =
    env.PI_WEB_MEMORY_AGENT_SOURCE_ID?.trim() || undefined;

  if (raw === "file") {
    return {
      backend: "file",
      dir,
      supabaseTable,
      defaultAgentSourceId,
    };
  }

  const supabaseUrl = env.PI_WEB_MEMORY_SUPABASE_URL?.trim();
  const supabaseKey = env.PI_WEB_MEMORY_SUPABASE_KEY?.trim();
  if (!supabaseUrl) {
    throw new MemoryConfigError(
      "PI_WEB_MEMORY_SUPABASE_URL is required when PI_WEB_MEMORY_BACKEND=supabase",
    );
  }
  if (!supabaseKey) {
    throw new MemoryConfigError(
      "PI_WEB_MEMORY_SUPABASE_KEY is required when PI_WEB_MEMORY_BACKEND=supabase",
    );
  }
  return {
    backend: "supabase",
    dir,
    supabaseUrl,
    supabaseKey,
    supabaseTable,
    defaultAgentSourceId,
  };
}

export interface CreateMemoryStoreOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly config?: MemoryConfig;
  /** Inject fetch for supabase tests. */
  readonly fetchImpl?: typeof fetch;
}

/** Build a MemoryStore from config/env. */
export function createMemoryStore(opts?: CreateMemoryStoreOptions): MemoryStore {
  const config = opts?.config ?? memoryConfigFromEnv(opts?.env ?? process.env);
  if (config.backend === "file") {
    return new FileMemoryStore(config.dir);
  }
  return new SupabaseMemoryStore({
    url: config.supabaseUrl!,
    apiKey: config.supabaseKey!,
    table: config.supabaseTable,
    fetchImpl: opts?.fetchImpl,
  });
}

/** Env keys to document / passthrough if host ever injects into child processes. */
export const MEMORY_ENV_KEYS = [
  "PI_WEB_MEMORY_BACKEND",
  "PI_WEB_MEMORY_DIR",
  "PI_WEB_MEMORY_SUPABASE_URL",
  "PI_WEB_MEMORY_SUPABASE_KEY",
  "PI_WEB_MEMORY_SUPABASE_TABLE",
  "PI_WEB_MEMORY_AGENT_SOURCE_ID",
] as const;

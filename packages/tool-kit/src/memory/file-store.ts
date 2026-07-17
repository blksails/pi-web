/**
 * FileMemoryStore — skills-like markdown files under a root directory.
 *
 * Layout:
 *   $root/global/<name>.md
 *   $root/by-source/<agentSourceId>/<name>.md
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseMemoryDocument, serializeMemoryDocument } from "./frontmatter.js";
import { normalizeMemoryName } from "./name.js";
import {
  filterEntries,
  isVisible,
  pickByName,
  searchEntries,
} from "./ops.js";
import type {
  MemoryDeleteOpts,
  MemoryEntry,
  MemoryEntryMeta,
  MemoryListFilter,
  MemoryStore,
  MemoryVisibility,
  MemoryWriteInput,
} from "./types.js";

function safeSegment(id: string): string {
  // Prevent path escape in agentSourceId directory names.
  return id.replace(/[^a-zA-Z0-9._@+-]/g, "_").slice(0, 200) || "_";
}

export class FileMemoryStore implements MemoryStore {
  constructor(private readonly rootDir: string) {}

  private globalDir(): string {
    return path.join(this.rootDir, "global");
  }

  private sourceDir(agentSourceId: string): string {
    return path.join(this.rootDir, "by-source", safeSegment(agentSourceId));
  }

  private filePath(entry: Pick<MemoryEntry, "name" | "scope" | "agentSourceId">): string {
    if (entry.scope === "global") {
      return path.join(this.globalDir(), `${entry.name}.md`);
    }
    if (!entry.agentSourceId) {
      throw new Error("agentSourceId required for agent-source path");
    }
    return path.join(this.sourceDir(entry.agentSourceId), `${entry.name}.md`);
  }

  private async readEntryFile(file: string): Promise<MemoryEntry | undefined> {
    try {
      const text = await readFile(file, "utf8");
      const parsed = parseMemoryDocument(text);
      if (!parsed.ok) return undefined;
      return parsed.entry;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      throw err;
    }
  }

  private async loadAll(): Promise<MemoryEntry[]> {
    const out: MemoryEntry[] = [];
    // global
    try {
      const gdir = this.globalDir();
      const files = await readdir(gdir);
      for (const f of files) {
        if (!f.endsWith(".md")) continue;
        const entry = await this.readEntryFile(path.join(gdir, f));
        if (entry) out.push(entry);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    // by-source/*
    try {
      const bySource = path.join(this.rootDir, "by-source");
      const sources = await readdir(bySource);
      for (const src of sources) {
        const dir = path.join(bySource, src);
        let files: string[];
        try {
          files = await readdir(dir);
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith(".md")) continue;
          const entry = await this.readEntryFile(path.join(dir, f));
          if (entry) out.push(entry);
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return out;
  }

  async get(name: string, vis?: MemoryVisibility): Promise<MemoryEntry | undefined> {
    const n = normalizeMemoryName(name);
    if (!n.ok) return undefined;
    const candidates: MemoryEntry[] = [];
    const globalPath = path.join(this.globalDir(), `${n.name}.md`);
    const g = await this.readEntryFile(globalPath);
    if (g) candidates.push(g);
    const agentId = vis?.agentSourceId?.trim();
    if (agentId) {
      const localPath = path.join(this.sourceDir(agentId), `${n.name}.md`);
      const local = await this.readEntryFile(localPath);
      if (local) candidates.push(local);
    }
    return pickByName(candidates, n.name, vis);
  }

  async put(input: MemoryWriteInput): Promise<MemoryEntry> {
    const n = normalizeMemoryName(input.name);
    if (!n.ok) {
      throw Object.assign(new Error(n.message), { code: "INVALID_NAME" as const });
    }
    const scope = input.scope ?? "global";
    const agentSourceId =
      scope === "agent-source" ? input.agentSourceId?.trim() : undefined;
    if (scope === "agent-source" && !agentSourceId) {
      throw Object.assign(
        new Error("agentSourceId is required when scope is agent-source"),
        { code: "INVALID_SCOPE" as const },
      );
    }

    const now = new Date().toISOString();
    const existing = await this.readEntryFile(
      this.filePath({ name: n.name, scope, agentSourceId }),
    );
    const entry: MemoryEntry = {
      name: n.name,
      description: input.description,
      tags: input.tags ? [...input.tags] : [],
      scope,
      agentSourceId,
      content: input.content,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const fp = this.filePath(entry);
    await mkdir(path.dirname(fp), { recursive: true });
    await writeFile(fp, serializeMemoryDocument(entry), "utf8");
    return entry;
  }

  async delete(name: string, opts?: MemoryDeleteOpts): Promise<boolean> {
    const n = normalizeMemoryName(name);
    if (!n.ok) return false;

    const tryUnlink = async (fp: string): Promise<boolean> => {
      try {
        await rm(fp);
        return true;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw err;
      }
    };

    const scope = opts?.scope;
    const agentId = opts?.agentSourceId?.trim();

    if (scope === "agent-source") {
      if (!agentId) return false;
      return tryUnlink(
        this.filePath({ name: n.name, scope: "agent-source", agentSourceId: agentId }),
      );
    }
    if (scope === "global") {
      return tryUnlink(this.filePath({ name: n.name, scope: "global" }));
    }

    // Prefer agent-source then global when both visible.
    let deleted = false;
    if (agentId) {
      deleted =
        (await tryUnlink(
          this.filePath({
            name: n.name,
            scope: "agent-source",
            agentSourceId: agentId,
          }),
        )) || deleted;
    }
    if (!deleted) {
      deleted = await tryUnlink(this.filePath({ name: n.name, scope: "global" }));
    }
    return deleted;
  }

  async list(filter?: MemoryListFilter): Promise<MemoryEntryMeta[]> {
    const all = await this.loadAll();
    return filterEntries(all, filter);
  }

  async search(query: string, filter?: MemoryListFilter): Promise<MemoryEntryMeta[]> {
    const all = await this.loadAll();
    return searchEntries(all, query, filter);
  }

  /** Test helper: raw visibility check re-export surface. */
  static isVisible = isVisible;
}

/**
 * Minimal YAML frontmatter encode/decode for skills-like memory documents.
 * Supports flat scalars, string arrays (inline or block list), no nested objects.
 * No third-party yaml dependency.
 */

import type { MemoryEntry, MemoryScope } from "./types.js";

const FM_OPEN = "---\n";
const FM_CLOSE = "\n---\n";

export type FrontmatterParseResult =
  | { readonly ok: true; readonly entry: MemoryEntry }
  | { readonly ok: false; readonly message: string };

function isScope(v: unknown): v is MemoryScope {
  return v === "global" || v === "agent-source";
}

function parseScalar(raw: string): string | number | boolean {
  const s = raw.trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  if (s === "true") return true;
  if (s === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  return s;
}

function parseInlineArray(raw: string): string[] {
  const inner = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim() === "") return [];
  return inner.split(",").map((p) => {
    const t = p.trim();
    if (
      (t.startsWith('"') && t.endsWith('"')) ||
      (t.startsWith("'") && t.endsWith("'"))
    ) {
      return t.slice(1, -1);
    }
    return t;
  });
}

/**
 * Parse `---\n...\n---\nbody` into a MemoryEntry-shaped object.
 * Missing optional fields get safe defaults; missing required fields fail.
 */
export function parseMemoryDocument(text: string): FrontmatterParseResult {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized.startsWith("---\n") && !normalized.startsWith("---\r\n")) {
    return { ok: false, message: "document must start with YAML frontmatter (---)" };
  }
  const afterOpen = normalized.slice(4); // after "---\n"
  const closeIdx = afterOpen.indexOf("\n---\n");
  if (closeIdx < 0) {
    // allow trailing --- at EOF without trailing newline body
    const alt = afterOpen.indexOf("\n---");
    if (alt < 0) {
      return { ok: false, message: "missing closing frontmatter delimiter (---)" };
    }
    const yamlBlock = afterOpen.slice(0, alt);
    const body = afterOpen.slice(alt + 4).replace(/^\n/, "");
    return buildEntry(yamlBlock, body);
  }
  const yamlBlock = afterOpen.slice(0, closeIdx);
  const body = afterOpen.slice(closeIdx + 5); // after "\n---\n"
  return buildEntry(yamlBlock, body);
}

function buildEntry(yamlBlock: string, body: string): FrontmatterParseResult {
  const map = new Map<string, unknown>();
  const lines = yamlBlock.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i += 1;
      continue;
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (!m) {
      return { ok: false, message: `invalid frontmatter line: ${line}` };
    }
    const key = m[1]!;
    const rest = m[2] ?? "";
    if (rest === "" || rest === "|" || rest === ">") {
      // block list for tags, or empty
      const items: string[] = [];
      i += 1;
      while (i < lines.length) {
        const next = lines[i] ?? "";
        const listItem = /^\s*-\s+(.*)$/.exec(next);
        if (!listItem) break;
        items.push(String(parseScalar(listItem[1] ?? "")));
        i += 1;
      }
      map.set(key, items);
      continue;
    }
    if (rest.startsWith("[")) {
      map.set(key, parseInlineArray(rest));
    } else {
      map.set(key, parseScalar(rest));
    }
    i += 1;
  }

  const name = map.get("name");
  if (typeof name !== "string" || name.trim() === "") {
    return { ok: false, message: "frontmatter.name is required" };
  }
  const scopeRaw = map.get("scope") ?? "global";
  if (!isScope(scopeRaw)) {
    return { ok: false, message: `invalid scope: ${String(scopeRaw)}` };
  }
  const tagsRaw = map.get("tags");
  const tags = Array.isArray(tagsRaw)
    ? tagsRaw.map(String)
    : typeof tagsRaw === "string"
      ? [tagsRaw]
      : [];

  const description =
    typeof map.get("description") === "string"
      ? (map.get("description") as string)
      : undefined;
  const agentSourceId =
    typeof map.get("agentSourceId") === "string"
      ? (map.get("agentSourceId") as string)
      : undefined;
  const createdAt =
    typeof map.get("createdAt") === "string"
      ? (map.get("createdAt") as string)
      : new Date(0).toISOString();
  const updatedAt =
    typeof map.get("updatedAt") === "string"
      ? (map.get("updatedAt") as string)
      : createdAt;

  if (scopeRaw === "agent-source" && (!agentSourceId || agentSourceId.trim() === "")) {
    return {
      ok: false,
      message: "agentSourceId is required when scope is agent-source",
    };
  }

  const entry: MemoryEntry = {
    name: name.trim(),
    description,
    tags,
    scope: scopeRaw,
    agentSourceId: scopeRaw === "agent-source" ? agentSourceId : undefined,
    content: body.replace(/^\n/, "").replace(/\n$/, "") === body.trimEnd()
      ? body.replace(/\n$/, "")
      : body.replace(/\n$/, ""),
    createdAt,
    updatedAt,
  };
  // Normalize content: strip single trailing newline for stable round-trip
  return {
    ok: true,
    entry: { ...entry, content: body.replace(/\n$/, "") },
  };
}

function quoteIfNeeded(s: string): string {
  if (s === "" || /[:#\[\]{},\n]/.test(s) || s !== s.trim()) {
    return JSON.stringify(s);
  }
  return s;
}

/** Serialize a MemoryEntry to skills-like markdown with YAML frontmatter. */
export function serializeMemoryDocument(entry: MemoryEntry): string {
  const lines: string[] = [];
  lines.push(`name: ${quoteIfNeeded(entry.name)}`);
  if (entry.description !== undefined && entry.description !== "") {
    lines.push(`description: ${quoteIfNeeded(entry.description)}`);
  }
  if (entry.tags.length > 0) {
    lines.push("tags:");
    for (const t of entry.tags) {
      lines.push(`  - ${quoteIfNeeded(t)}`);
    }
  } else {
    lines.push("tags: []");
  }
  lines.push(`scope: ${entry.scope}`);
  if (entry.scope === "agent-source" && entry.agentSourceId) {
    lines.push(`agentSourceId: ${quoteIfNeeded(entry.agentSourceId)}`);
  }
  lines.push(`createdAt: ${entry.createdAt}`);
  lines.push(`updatedAt: ${entry.updatedAt}`);
  const yaml = lines.join("\n");
  const body = entry.content.endsWith("\n") ? entry.content : `${entry.content}\n`;
  return `${FM_OPEN}${yaml}${FM_CLOSE}${body}`;
}

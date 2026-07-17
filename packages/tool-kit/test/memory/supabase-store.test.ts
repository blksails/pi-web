/**
 * SupabaseMemoryStore contract with an in-memory PostgREST mock.
 */

import { describe } from "vitest";
import { SupabaseMemoryStore } from "../../src/memory/supabase-store.js";
import { runMemoryStoreContract } from "./contract.js";

interface Row {
  name: string;
  description: string | null;
  content: string;
  tags: string[] | null;
  scope: string;
  agent_source_id: string | null;
  created_at: string;
  updated_at: string;
}

function keyOf(r: Pick<Row, "name" | "scope" | "agent_source_id">): string {
  return `${r.scope}\0${r.agent_source_id ?? ""}\0${r.name}`;
}

function parseQuery(url: string): URLSearchParams {
  const u = new URL(url);
  return u.searchParams;
}

function matchFilters(row: Row, params: URLSearchParams): boolean {
  const record = row as unknown as Record<string, unknown>;
  for (const [k, v] of params.entries()) {
    if (k === "select" || k === "on_conflict") continue;
    if (v.startsWith("eq.")) {
      const want = v.slice(3);
      const got = String(record[k] ?? "");
      if (got !== want) return false;
    }
  }
  return true;
}

function createMockFetch(): typeof fetch {
  const table = new Map<string, Row>();

  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const params = parseQuery(url);

    if (method === "GET") {
      const rows = [...table.values()].filter((r) => matchFilters(r, params));
      return new Response(JSON.stringify(rows), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "POST") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Row;
      const k = keyOf(body);
      const prev = table.get(k);
      const next: Row = {
        ...body,
        created_at: prev?.created_at ?? body.created_at,
        updated_at: body.updated_at,
      };
      table.set(k, next);
      return new Response(JSON.stringify([next]), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }

    if (method === "DELETE") {
      const removed: Row[] = [];
      for (const [k, r] of table) {
        if (matchFilters(r, params)) {
          removed.push(r);
          table.delete(k);
        }
      }
      return new Response(JSON.stringify(removed), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response("method not allowed", { status: 405 });
  };
}

describe("SupabaseMemoryStore contract (mock PostgREST)", () => {
  runMemoryStoreContract(() => {
    return new SupabaseMemoryStore({
      url: "https://example.supabase.co",
      apiKey: "test-key",
      table: "pi_web_memories",
      fetchImpl: createMockFetch(),
    });
  });
});

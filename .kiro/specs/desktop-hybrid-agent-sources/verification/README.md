# Verification (2026-07-24)

## Commands
- `packages/server`: vitest `test/agent-source-list/` + `test/auth/desktop-capabilities-client.test.ts` + `test/host-assembly/default-capabilities.test.ts` → **59 passed**
- `packages/server` tsc --noEmit → **exit 0**
- app tsc --noEmit → **exit 0**

## Scenario coverage (hybrid-agent-sources.test.ts)
1. No credential → local scan only; no capabilities/registry fetch
2. Credential + mock capabilities + mock registry → local ∪ online `id@stable`; plugin filtered; response has no consume token
3. Credential + capabilities 503 → local only, HTTP 200

## Defaults
- Unset `PI_WEB_SOURCES_ROOT` → `~/.pi-web/agents` (pi-handler `defaultSourcesRoot`)

## Token hygiene
- Grant tokens only in memory cache + Authorization header; no writeFile/writeJson in client/provider sources

## Feature-level validation (validate-impl · 2026-07-27 · GO)

Full-suite: `pnpm -r --workspace-concurrency=1 run test` → **EXIT=0**, 14 packages, 0 FAIL.

Runtime smoke (real server via `pnpm dev:server`, not a test harness):
- `PI_WEB_SOURCES_ROOT=/tmp/nonexistent` → `GET /api/agent-sources` = **200** `{"sources":[],...}` (Req 1.3 — missing root is an empty contribution, not a 500)
- `PI_WEB_SOURCES_ROOT=$PWD/examples` → **5 records**, each `origin:"scan"`, fields = id/source/name/kind/origin/mode/title/description/avatar (Req 6.2)
- Boot log: zero errors; **zero** capabilities/registry requests while logged out (Req 2.4)

Static proofs:
- `@pi-clouds/registry-client`: **no real import** under `packages/server/src` (both grep hits are comments); absent from package.json (scope ironclad)
- No `install|resolve|clone|spawn|createSession` in the new P1 code → no P2 over-implementation (Req 7)
- No `writeFile|unlink|rm|mkdir|rename` in registry-http-provider / composite-provider / desktop-capabilities-client → online failure cannot mutate local sources (Req 5.4)

Coverage: **21/21 acceptance criteria, 8/8 requirements**.

⚠ Gap (non-blocking): no dedicated regression test for pagination **across the hybrid union** (page 1 registry → page 2 scan). Mechanism is provable — cursor payload is the sort-key triple and shares the same total-order comparator (origin→name→id, fixed `"en"` locale) — so this is thin test coverage, not a defect.

## Auth shared refresh fix (2026-07-24 later)
- `DesktopAuthProvider` wraps ChatApp; LoginControl + list refresh share state.
- `test/auth/desktop-auth-shared-refresh.test.tsx` — login/logout identity change re-calls listAgentSources.
- typecheck-server.log / typecheck-app.log capture `exit_code=0` + PASS line.

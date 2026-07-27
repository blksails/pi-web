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

## Auth shared refresh fix (2026-07-24 later)
- `DesktopAuthProvider` wraps ChatApp; LoginControl + list refresh share state.
- `test/auth/desktop-auth-shared-refresh.test.tsx` — login/logout identity change re-calls listAgentSources.
- typecheck-server.log / typecheck-app.log capture `exit_code=0` + PASS line.

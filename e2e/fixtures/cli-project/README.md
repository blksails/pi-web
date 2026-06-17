# cli-project fixture

A plain directory with **no entry file** (`index.ts`). The agent-source-resolver
detects the absence of an entry and falls back to **general CLI mode**.

Used by `e2e/cli-fallback.e2e.ts` to verify the fallback path streams a reply in
the browser exactly like custom-agent mode.

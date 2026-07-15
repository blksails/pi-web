# archive-agent

pi-web example agent with **zip / unzip / unrar** tools (kiro feature `archive-tools`).

## Tools

| Tool | Purpose |
|------|---------|
| `zip` | Create `.zip` from workspace paths |
| `unzip` | Extract `.zip` with zip-slip rejection |
| `unrar` | Extract `.rar` via host backend (`unrar` / `unar` / `bsdtar`) |

Core logic: `@blksails/pi-web-tool-kit` → `src/archive/*` (exported from `/runtime`).

## Run

```bash
# from pi-web repo root
pnpm dev
# pick source: examples/archive-agent
```

## Tests

```bash
pnpm --filter @blksails/pi-web-tool-kit test -- test/archive
```

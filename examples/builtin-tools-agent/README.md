# builtin-tools-agent

A [pi-web](https://github.com/pi-web) example agent with the **built-in filesystem and shell toolset** explicitly enabled.

## Overview

This example demonstrates how to use `tools` allowlist in `defineAgent` to explicitly opt-in to pi's built-in tools. It is useful as a reference when you want to cherry-pick which built-in tools are available to your agent.

### Tool Stance Comparison

| Example | Setting | Effect |
|---|---|---|
| `hello-agent` | `noTools: "builtin"` | Disables built-in tools; custom/extension tools only |
| `minimal-agent` | `noTools: "all"` | Disables all tools (zero-capability baseline) |
| **`builtin-tools-agent`** | `tools: [...]` | Explicitly enables listed built-in tools (allowlist) |

## Built-in Tools

pi currently ships the following built-in tools:

| Tool | Description |
|---|---|
| `bash` | Execute shell commands |
| `read` | Read file contents |
| `write` | Write / create files |
| `edit` | Edit files via exact text replacement |
| `patch` | Apply unified diffs |
| `ls` | List directory contents |
| `grep` | Search file contents by pattern |
| `glob` | Find files by glob pattern |
| `fetch` | Fetch URLs |

## Tool Resolution Rules

- **No `tools`, no `noTools`** → pi default discovery; built-in tools are enabled by default.
- **`tools: [...]`** → Allowlist; only the listed tools are enabled. This example lists all built-ins explicitly so they are visible and easy to trim.
- **`excludeTools: [...]`** → Denylist applied _after_ the allowlist.

## Usage

```ts
import { defineAgent } from "@blksails/pi-web-agent-kit";

export default defineAgent({
  // model omitted → inherits defaultProvider/defaultModel from ~/.pi/agent/settings.json
  systemPrompt: "You are builtin-tools-agent ...",
  tools: ["read", "ls", "grep", "glob", "bash", "edit", "write", "patch", "fetch"],
});
```

To disable a specific tool, simply remove it from the `tools` array.  
To use a denylist instead, replace `tools` with `excludeTools`:

```ts
excludeTools: ["bash", "write", "edit", "patch"],
```

## Model

The `model` field is intentionally omitted. The agent inherits `defaultProvider` / `defaultModel` from `~/.pi/agent/settings.json` and resolves credentials from `~/.pi/agent/auth.json`, so it works out of the box with any pi login.

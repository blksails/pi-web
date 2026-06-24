# server-driven-ui-agent

A [pi-web](https://github.com/pi-web) example agent that renders **rich UI directly from the backend** (server-driven UI), zero-config on the front end.

## Overview

The agent declares UI as data; the web UI renders it without any per-agent front-end code. Two trust paths:

- **`kind: "builtin"`** — pick a whitelisted front-end component by name and pass JSON props (e.g. `metric`, `table`, `card`, `alert`, `progress`, `keyValue`, `codeBlock`).
- **`kind: "sandbox"`** — a declarative node tree rendered by a restricted interpreter (no code execution, protocol-whitelisted `href`/`src`, read-only).

## How the agent emits UI

There is no separate "send UI" RPC. UI is emitted from inside a tool via the tool's `onUpdate` callback, using the `emitUi` helper:

```ts
import { defineAgent, emitUi } from "@blksails/pi-web-agent-kit";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const showDashboard = defineTool({
  name: "show_dashboard",
  parameters: Type.Object({}),
  async execute(_id, _params, _signal, onUpdate) {
    emitUi(onUpdate, { kind: "builtin", component: "metric",
      props: { label: "Active", value: "1,284", delta: "+12%", tone: "success" } });
    emitUi(onUpdate, { kind: "sandbox", root: {
      el: "box", direction: "col", children: [
        { el: "heading", level: 2, text: "Released v1.4.2" },
        { el: "badge", text: "stable", style: { tone: "success" } },
      ] } });
    return { content: [{ type: "text", text: "Dashboard rendered." }], details: undefined };
  },
});
```

### Pipeline

```
tool.execute → emitUi(onUpdate, spec)
  → onUpdate({ content: [], details: { __piWebUi: spec } })   (agent-kit)
  → pi SDK emits tool_execution_update { partialResult }
  → server translate-event detects the marker → data-pi-ui frame   (no marker → tool-output-available preliminary, fed into the same tool card)
  → SSE → useChat → message part { type: "data-pi-ui", data: spec }
  → <PiChat> → PiUiPart → builtin component | sandbox interpreter
```

> `emitUi` only works while a tool is executing — i.e. "to show UI, emit it from inside a tool".

## Usage

```bash
pi-web ./examples/server-driven-ui-agent
```

Then ask it to *"show the dashboard"*. You'll see a metric card, a status table, and a sandbox-rendered release-notes block appear inline in the conversation.

## See also

- `ui-demo-agent` — interactive extension UI (`select`/`confirm`/`input`/`notify`/`setStatus`).
- Protocol: `@blksails/pi-web-protocol` `UiSpec` / `PI_UI_TOOL_DETAILS_KEY` / `extractToolDetailsUiSpec`.
- Front-end: `@blksails/pi-web-ui` `PiUiPart` / `SandboxRenderer` / `registerUiComponent`.

## Model

`model` is omitted → inherits `defaultProvider` / `defaultModel` from `~/.pi/agent/settings.json`.

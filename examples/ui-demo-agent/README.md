# ui-demo-agent

A [pi-web](https://github.com/pi-web) example agent showcasing **all common extension UI surfaces** in one place.

## Overview

A tool's `execute` receives an `ExtensionContext` as its 5th argument; `ctx.ui.*` drives interactive dialogs and ambient surfaces that pi-web renders zero-config. This agent exposes two tools:

- **`deploy`** — interactive dialogs: `select` an environment, then `confirm`.
- **`create_project`** — a form + ambient status: collect fields via `input`, push step progress via `setStatus`, report via `notify`.

The same agent runs in the pi CLI (terminal dialogs / status line / notifications) and in pi-web (web dialogs / status bar / toasts) — you only write the agent side.

## Extension UI surfaces used

| API | Signature | Blocking | Rendered in pi-web as | Used by |
|---|---|---|---|---|
| `ctx.ui.select` | `select(title, options[]) → Promise<string \| undefined>` | ✅ | Single-select dialog | `deploy` |
| `ctx.ui.confirm` | `confirm(title, message) → Promise<boolean>` | ✅ | Confirmation dialog | `deploy` |
| `ctx.ui.input` | `input(title, placeholder?) → Promise<string \| undefined>` | ✅ | Text input dialog | `create_project` |
| `ctx.ui.setStatus` | `setStatus(key, text \| undefined) → void` | ❌ | Top status bar (`undefined` clears) | `create_project` |
| `ctx.ui.notify` | `notify(message, type?: "info" \| "warning" \| "error") → void` | ❌ | Notification toast | both |

> Interactive (`select`/`confirm`/`input`) calls block until the user responds; cancel resolves to `undefined`/`false`. Ambient (`setStatus`/`notify`) calls do not block.
>
> pi SDK's `ctx.ui` also has TUI-only surfaces (`setFooter`/`setHeader`/`custom`/`setEditorComponent`/`onRawInput`, …) that pi-web does not render. Guard them with `if (ctx.mode === "tui") { … }`.

## Usage

```bash
pi-web ./examples/ui-demo-agent
```

Then try:
- *"deploy"* → shows an inline environment selector, then an inline confirm card.
- *"create a project"* → pops an input for the name, then the author, shows progress in the status bar, and toasts the result.

## Front-end wiring

Zero-config: `@blksails/react`'s `useExtensionUI` + `<PiChat extensionUI={…}>` renders all of the above (interactions as inline `<PiInteraction>` cards in the message stream, plus the status bar and notification toasts).

## Model

The `model` field is intentionally omitted. The agent inherits `defaultProvider` / `defaultModel` from `~/.pi/agent/settings.json` and credentials from `~/.pi/agent/auth.json`, so it works with any pi login.

## See also

- Node e2e harness for extension UI: `e2e/node/extension-ui-select.e2e.test.ts`.

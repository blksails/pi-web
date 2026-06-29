import * as React from "react";
import { defineWebExtension, type UiRpcClient } from "@blksails/pi-web-kit";

function CodeReviewCard({ part }: { part: { output?: unknown; state?: string } }): React.JSX.Element {
  const details = (part.output as { details?: { findings?: string[] } } | undefined)?.details;
  const findings = details?.findings ?? [];
  return (
    <div
      data-testid="code-review-card"
      style={{
        border: "1px solid hsl(var(--border))",
        borderLeft: "3px solid hsl(var(--primary))",
        borderRadius: 10,
        padding: 12,
        background: "hsl(var(--muted))",
        color: "hsl(var(--foreground))",
        maxWidth: 560,
      }}
    >
      <strong>代码检视 · {findings.length} 项</strong>
      <ul data-testid="code-review-findings">
        {findings.map((f, i) => (
          <li key={i}>{f}</li>
        ))}
      </ul>
    </div>
  );
}

export default defineWebExtension({
  manifestId: "code-review",
  capabilities: ["renderers", "contributions"],
  renderers: {
    tools: { code_review: CodeReviewCard as never },
  },
  contributions: {
    slash: {
      async list(query: string, rpc: UiRpcClient) {
        const res = await rpc.request({ point: "slash", action: "list", payload: { query } });
        return (res.ok ? res.result : []) as Array<{ id: string; title: string }>;
      },
      async execute(id: string, rpc: UiRpcClient) {
        await rpc.request({ point: "slash", action: "execute", payload: { id } });
      },
    },
  },
});

/**
 * agent-slash-completion task 5/6.2:PiCommandPalette 伪命令并入单浮层 + select 分流。
 * 覆盖 Req 2.2/2.3(并入复用单浮层、失败不阻塞)、Req 3.1/3.2(伪命令只填入不执行)、
 * Req 5.1/5.3(执行型命令仍执行、不破坏)。
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { PiCommandPalette } from "../../src/controls/pi-command-palette.js";
import type { CompletionClient } from "../../src/completion/use-completion.js";
import { mockControls, sampleCommands } from "../fixtures/mock-session.js";

function pseudoClient(opts: { fail?: boolean } = {}): CompletionClient {
  return {
    getCompletionTriggers: async () => ({
      triggers: [{ trigger: "/", extract: "lineStart" }],
    }),
    getCompletion: async (_id, _trigger, q) => {
      if (opts.fail === true) throw new Error("boom");
      const all = [
        {
          providerId: "agent-slash",
          kind: "agent-slash",
          id: "img-gen",
          label: "/img-gen",
          insertText: "/img-gen ",
          detail: "生成图像",
        },
        {
          providerId: "agent-slash",
          kind: "agent-slash",
          id: "img-edit",
          label: "/img-edit",
          insertText: "/img-edit ",
        },
      ];
      return { items: all.filter((i) => i.id.startsWith(q)), groups: [] };
    },
  };
}

function Harness({
  client,
  onSubmit,
}: {
  client: CompletionClient;
  onSubmit?: (cmd: import("@blksails/pi-web-protocol").RpcSlashCommand) => void;
}): React.JSX.Element {
  const [value, setValue] = React.useState("/");
  return (
    <div>
      <input
        aria-label="prompt"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <PiCommandPalette
        controls={mockControls({ commands: sampleCommands() })}
        value={value}
        onChange={setValue}
        client={client}
        sessionId="s1"
        {...(onSubmit !== undefined ? { onSubmit } : {})}
      />
      <span data-testid="value">{value}</span>
    </div>
  );
}

describe("PiCommandPalette agent-slash 伪命令", () => {
  it("伪命令候选与执行型命令并入同一浮层", async () => {
    render(<Harness client={pseudoClient()} />);
    expect(await screen.findByText("/img-gen")).toBeInTheDocument();
    expect(screen.getByText("/img-edit")).toBeInTheDocument();
    // 执行型命令并存(单浮层)。
    expect(screen.getByText("/help")).toBeInTheDocument();
  });

  it("选中伪命令只填入 insertText、不执行(不调 onSubmit)", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness client={pseudoClient()} onSubmit={onSubmit} />);
    await user.click(await screen.findByText("/img-gen"));
    expect(screen.getByTestId("value").textContent).toBe("/img-gen ");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("选中执行型命令(source=prompt,无 argSpec)→ 调 onSubmit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(<Harness client={pseudoClient()} onSubmit={onSubmit} />);
    await user.click(await screen.findByText("/help"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("getCompletion 失败 → 伪命令置空,不阻塞执行型命令与输入", async () => {
    render(<Harness client={pseudoClient({ fail: true })} />);
    expect(await screen.findByText("/help")).toBeInTheDocument();
    expect(screen.queryByText("/img-gen")).not.toBeInTheDocument();
  });
});

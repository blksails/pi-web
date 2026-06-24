import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useSuggestions } from "../../src/hooks/use-suggestions.js";
import type { Suggestion } from "../../src/hooks/use-suggestions.js";
import type { UsePiControlsResult } from "../../src/hooks/use-pi-controls.js";
import type { RpcSlashCommand } from "@blksails/pi-web-protocol";

function makeControls(
  overrides: Partial<UsePiControlsResult> = {},
): UsePiControlsResult {
  return {
    getCommands: vi.fn(async () => ({ commands: [] })),
    commands: undefined,
    state: {
      getCommands: { pending: false, error: undefined },
    },
    ...overrides,
  } as unknown as UsePiControlsResult;
}

const CMD_A: RpcSlashCommand = {
  name: "compact",
  description: "compact the session",
  source: "prompt",
  sourceInfo: {
    path: "/cmd",
    source: "test",
    scope: "project",
    origin: "package",
  },
};
const CMD_B: RpcSlashCommand = {
  name: "review",
  source: "skill",
  sourceInfo: {
    path: "/cmd",
    source: "test",
    scope: "project",
    origin: "package",
  },
};

describe("useSuggestions", () => {
  it("returns [] when no commands and no presets", () => {
    const controls = makeControls({ commands: undefined });
    const { result } = renderHook(() => useSuggestions({ controls }));
    expect(result.current.items).toEqual([]);
  });

  it("returns [] when commands empty and presets undefined", () => {
    const controls = makeControls({ commands: [] });
    const { result } = renderHook(() => useSuggestions({ controls }));
    expect(result.current.items).toEqual([]);
  });

  it("maps RpcSlashCommand to Suggestion with mode fill", () => {
    const controls = makeControls({ commands: [CMD_A] });
    const { result } = renderHook(() => useSuggestions({ controls }));
    expect(result.current.items).toEqual([
      {
        id: "cmd:compact",
        label: "/compact",
        value: "/compact",
        mode: "fill",
      },
    ]);
  });

  it("maps command without description; label/value are slash name", () => {
    const controls = makeControls({ commands: [CMD_B] });
    const { result } = renderHook(() => useSuggestions({ controls }));
    expect(result.current.items[0]).toEqual({
      id: "cmd:review",
      label: "/review",
      value: "/review",
      mode: "fill",
    });
  });

  it("merges commands and presets (commands ∪ presets)", () => {
    const preset: Suggestion = {
      id: "p1",
      label: "Summarize",
      value: "Please summarize",
      mode: "send",
    };
    const controls = makeControls({ commands: [CMD_A] });
    const { result } = renderHook(() =>
      useSuggestions({ controls, presets: [preset] }),
    );
    expect(result.current.items).toEqual([
      {
        id: "cmd:compact",
        label: "/compact",
        value: "/compact",
        mode: "fill",
      },
      preset,
    ]);
  });

  it("returns presets only when controls absent", () => {
    const preset: Suggestion = {
      id: "p1",
      label: "Hi",
      value: "Hi",
      mode: "send",
    };
    const { result } = renderHook(() => useSuggestions({ presets: [preset] }));
    expect(result.current.items).toEqual([preset]);
  });

  it("returns [] when nothing provided at all", () => {
    const { result } = renderHook(() => useSuggestions({}));
    expect(result.current.items).toEqual([]);
  });

  it("exposes pending reflecting controls getCommands state", () => {
    const controls = makeControls({
      commands: [CMD_A],
      state: {
        getCommands: { pending: true, error: undefined },
      } as unknown as UsePiControlsResult["state"],
    });
    const { result } = renderHook(() => useSuggestions({ controls }));
    expect(result.current.pending).toBe(true);
  });

  it("pending is false without controls", () => {
    const { result } = renderHook(() => useSuggestions({}));
    expect(result.current.pending).toBe(false);
  });
});

describe("useSuggestions merge strategies", () => {
  const preset: Suggestion = {
    id: "p1",
    label: "Summarize",
    value: "Please summarize",
    mode: "send",
  };
  const cmdSuggestion: Suggestion = {
    id: "cmd:compact",
    label: "/compact",
    value: "/compact",
    mode: "fill",
  };

  it("default (no merge) keeps commands before presets — backward compatible", () => {
    const controls = makeControls({ commands: [CMD_A] });
    const { result } = renderHook(() =>
      useSuggestions({ controls, presets: [preset] }),
    );
    expect(result.current.items).toEqual([cmdSuggestion, preset]);
  });

  it("append: commands before presets", () => {
    const controls = makeControls({ commands: [CMD_A] });
    const { result } = renderHook(() =>
      useSuggestions({ controls, presets: [preset], merge: "append" }),
    );
    expect(result.current.items).toEqual([cmdSuggestion, preset]);
  });

  it("prepend: presets before commands", () => {
    const controls = makeControls({ commands: [CMD_A] });
    const { result } = renderHook(() =>
      useSuggestions({ controls, presets: [preset], merge: "prepend" }),
    );
    expect(result.current.items).toEqual([preset, cmdSuggestion]);
  });

  it("replace: presets only, commands dropped", () => {
    const controls = makeControls({ commands: [CMD_A, CMD_B] });
    const { result } = renderHook(() =>
      useSuggestions({ controls, presets: [preset], merge: "replace" }),
    );
    expect(result.current.items).toEqual([preset]);
  });

  it("replace with empty presets falls back to commands (no empty state)", () => {
    const controls = makeControls({ commands: [CMD_A] });
    const { result } = renderHook(() =>
      useSuggestions({ controls, presets: [], merge: "replace" }),
    );
    expect(result.current.items).toEqual([cmdSuggestion]);
  });
});

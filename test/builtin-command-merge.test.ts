/**
 * to-rpc-command — 映射与合流（builtin-plugin-command 任务 5.1）。
 */
import { describe, it, expect } from "vitest";
import { BUILTIN_COMMANDS } from "@blksails/pi-web-tool-kit/commands";
import type { RpcSlashCommand } from "@blksails/pi-web-protocol";
import {
  toRpcSlashCommand,
  mergeBuiltinCommands,
} from "../lib/app/plugin-command/to-rpc-command.js";

const agentCmd = (name: string): RpcSlashCommand => ({
  name,
  source: "prompt",
  sourceInfo: { path: "/x", source: "x", scope: "project", origin: "top-level" },
});

describe("toRpcSlashCommand", () => {
  it("映射为 source=builtin 且无 sourceInfo", () => {
    const r = toRpcSlashCommand(BUILTIN_COMMANDS[0]!);
    expect(r.source).toBe("builtin");
    expect(r.name).toBe("plugin");
    expect(r.sourceInfo).toBeUndefined();
  });
});

describe("mergeBuiltinCommands", () => {
  it("内置命令追加在 agent 命令后（不改既有默认选中）", () => {
    const merged = mergeBuiltinCommands(BUILTIN_COMMANDS, [agentCmd("foo")]);
    expect(merged[0]?.name).toBe("foo"); // 既有命令仍在前(默认选中不变)
    const plugin = merged.find((c) => c.name === "plugin");
    expect(plugin?.source).toBe("builtin");
  });

  it("同名内置优先（过滤同名 agent 命令）", () => {
    const merged = mergeBuiltinCommands(BUILTIN_COMMANDS, [agentCmd("plugin"), agentCmd("bar")]);
    const plugins = merged.filter((c) => c.name === "plugin");
    expect(plugins).toHaveLength(1);
    expect(plugins[0]?.source).toBe("builtin");
    expect(merged.map((c) => c.name)).toContain("bar");
  });
});

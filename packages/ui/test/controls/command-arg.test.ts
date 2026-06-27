/**
 * parseCommandStage 阶段解析单测(plugin-subcommand-completion)。
 */
import { describe, it, expect } from "vitest";
import {
  parseCommandStage,
  findSubcommand,
  type CommandArgSpec,
} from "../../src/controls/command-arg.js";

const PLUGIN: CommandArgSpec = {
  command: "plugin",
  subcommands: [
    { name: "install", aliases: ["add"], terminal: false, argKind: "localSource" },
    {
      name: "uninstall",
      aliases: ["remove"],
      terminal: false,
      argKind: "installedExt",
    },
    { name: "list", aliases: ["ls"], terminal: true },
  ],
};

describe("findSubcommand", () => {
  it("按名或别名匹配(大小写不敏感)", () => {
    expect(findSubcommand(PLUGIN, "install")?.name).toBe("install");
    expect(findSubcommand(PLUGIN, "ADD")?.name).toBe("install");
    expect(findSubcommand(PLUGIN, "remove")?.name).toBe("uninstall");
    expect(findSubcommand(PLUGIN, "nope")).toBeUndefined();
  });
});

describe("parseCommandStage", () => {
  it("无 spec → 命令名阶段(整段为 query)", () => {
    const s = parseCommandStage("/plugin install", undefined);
    expect(s).toEqual({ kind: "command", query: "plugin install" });
  });

  it("仍在打命令名 → command 阶段", () => {
    expect(parseCommandStage("/plu", PLUGIN)).toEqual({
      kind: "command",
      query: "plu",
    });
  });

  it("/plugin (尾空格) → subcommand 阶段, query 空", () => {
    expect(parseCommandStage("/plugin ", PLUGIN)).toEqual({
      kind: "subcommand",
      command: "plugin",
      query: "",
    });
  });

  it("/plugin un → subcommand 阶段按前缀过滤", () => {
    expect(parseCommandStage("/plugin un", PLUGIN)).toEqual({
      kind: "subcommand",
      command: "plugin",
      query: "un",
    });
  });

  it("/plugin install (尾空格) → arg 阶段, query 空, 替换区间在末尾", () => {
    const v = "/plugin install ";
    const s = parseCommandStage(v, PLUGIN);
    expect(s.kind).toBe("arg");
    if (s.kind === "arg") {
      expect(s.sub.name).toBe("install");
      expect(s.query).toBe("");
      expect(s.start).toBe(v.length);
      expect(s.end).toBe(v.length);
    }
  });

  it("/plugin install ./e → arg 阶段, query=./e, 区间覆盖末段", () => {
    const v = "/plugin install ./e";
    const s = parseCommandStage(v, PLUGIN);
    expect(s.kind).toBe("arg");
    if (s.kind === "arg") {
      expect(s.query).toBe("./e");
      expect(s.start).toBe(v.length - 3);
      expect(s.end).toBe(v.length);
      expect(v.slice(s.start, s.end)).toBe("./e");
    }
  });

  it("别名 add 也进入 install 的 arg 阶段", () => {
    const s = parseCommandStage("/plugin add ", PLUGIN);
    expect(s.kind).toBe("arg");
    if (s.kind === "arg") expect(s.sub.name).toBe("install");
  });

  it("跳过 -l flag 定位参数段", () => {
    const v = "/plugin install -l ./pkg";
    const s = parseCommandStage(v, PLUGIN);
    expect(s.kind).toBe("arg");
    if (s.kind === "arg") {
      expect(s.query).toBe("./pkg");
      expect(v.slice(s.start, s.end)).toBe("./pkg");
    }
  });

  it("flag 尾随空格 → 参数 query 空(列全部)", () => {
    const s = parseCommandStage("/plugin install -l ", PLUGIN);
    expect(s.kind).toBe("arg");
    if (s.kind === "arg") expect(s.query).toBe("");
  });

  it("终态子命令 list(尾空格) → 仍 subcommand 阶段(靠 Enter 执行)", () => {
    expect(parseCommandStage("/plugin list ", PLUGIN)).toEqual({
      kind: "subcommand",
      command: "plugin",
      query: "list",
    });
  });

  it("未知子命令 → subcommand 阶段(展示供选)", () => {
    expect(parseCommandStage("/plugin wat", PLUGIN)).toEqual({
      kind: "subcommand",
      command: "plugin",
      query: "wat",
    });
  });
});

/**
 * 视觉模型偏好:config 域 `aigc.visionModel` 的读写 + 「用一次就不再问」的写回时机。
 *
 * ★ 本文件真正的价值在**三条不该写回的路径**。写回是有副作用的(改用户的
 * `~/.pi/agent/aigc.json`),写错时机比不写更糟:
 *  - LLM 显式传了 `model` → 那是一次性指定,不代表用户取向;
 *  - 已有配置默认 → 本就是它自己,重复写盘无意义;
 *  - 写盘失败 → 必须静默吞掉,绝不能让一次解读因为配置写不进去而失败。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readVisionModelPreference,
  writeVisionModelPreference,
  visionModelResolver,
} from "../../src/vision/model-preference.js";

const ENV = "PI_WEB_VISION_MODEL_TEST";
let dir: string;
let file: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-vision-pref-"));
  file = path.join(dir, "aigc.json");
  delete process.env[ENV];
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env[ENV];
});

describe("读", () => {
  it("文件不存在 / 坏 JSON / 空串 → undefined(fail-soft,不抛)", () => {
    expect(readVisionModelPreference(dir)).toBeUndefined();
    fs.writeFileSync(file, "{ 这不是 JSON", "utf8");
    expect(readVisionModelPreference(dir)).toBeUndefined();
    fs.writeFileSync(file, JSON.stringify({ visionModel: "" }), "utf8");
    expect(readVisionModelPreference(dir)).toBeUndefined();
  });

  it("有值 → 原样返回", () => {
    fs.writeFileSync(file, JSON.stringify({ visionModel: "apiservices/gpt-5.4-mini" }), "utf8");
    expect(readVisionModelPreference(dir)).toBe("apiservices/gpt-5.4-mini");
  });
});

describe("写", () => {
  it("★ read-modify-write:不得抹掉同文件里的其它设置", () => {
    // schema 是 passthrough,且 /settings 会往同一文件写这些字段。整份覆盖 = 用户配置丢失。
    fs.writeFileSync(
      file,
      JSON.stringify({ disabledModels: ["gpt-image-2"], enablePromptOptimization: true }),
      "utf8",
    );
    writeVisionModelPreference("qiniu/openai/gpt-5.4", dir);
    const after = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(after["visionModel"]).toBe("qiniu/openai/gpt-5.4");
    expect(after["disabledModels"]).toEqual(["gpt-image-2"]);
    expect(after["enablePromptOptimization"]).toBe(true);
  });

  it("目录不存在 → 自建;空串 → 不写", () => {
    const nested = path.join(dir, "a", "b");
    writeVisionModelPreference("m1", nested);
    expect(readVisionModelPreference(nested)).toBe("m1");

    writeVisionModelPreference("", nested);
    expect(readVisionModelPreference(nested)).toBe("m1"); // 未被空串覆盖
  });

  it("★ 写盘失败静默吞掉(不抛)—— 写不进配置只该导致「下次还问」", () => {
    // 用一个「路径上有普通文件」的目录制造必然失败:mkdir 会 ENOTDIR。
    const blocked = path.join(dir, "afile", "sub");
    fs.writeFileSync(path.join(dir, "afile"), "x", "utf8");
    expect(() => writeVisionModelPreference("m1", blocked)).not.toThrow();
    expect(readVisionModelPreference(blocked)).toBeUndefined();
  });
});

describe("解析序:config > env > undefined", () => {
  it("config 有值 → 用 config,env 被忽略", () => {
    process.env[ENV] = "env/model";
    fs.writeFileSync(file, JSON.stringify({ visionModel: "cfg/model" }), "utf8");
    expect(visionModelResolver(ENV, dir)()).toBe("cfg/model");
  });

  it("config 无值 → 回落 env(无人值守通道依赖它,不可删)", () => {
    process.env[ENV] = "env/model";
    expect(visionModelResolver(ENV, dir)()).toBe("env/model");
  });

  it("都无 → undefined(交由弹层询问)", () => {
    expect(visionModelResolver(ENV, dir)()).toBeUndefined();
  });

  it("★ 每次调用现读:写回后**立即**生效,不必等下次会话", () => {
    const resolve = visionModelResolver(ENV, dir);
    expect(resolve()).toBeUndefined();
    writeVisionModelPreference("picked/in/dialog", dir);
    // 若实现改成装配期读一次并缓存,这里会仍是 undefined —— 那正是要避免的体验。
    expect(resolve()).toBe("picked/in/dialog");
  });
});

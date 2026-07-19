/**
 * sourceKey 单元测试(spec source-settings-and-slots,任务 0.1;地基 G3;Req 0.1-0.4)。
 *
 * 覆盖:同输入恒同输出、不同 sourceId 派生不同 key(碰撞用例)、升版(version/channel 变、
 * sourceId 不变)散列不变、输出字符集安全(可直接用作目录段/DB 主键,防路径注入)。
 */
import { describe, it, expect } from "vitest";
import { sourceKey, isSourceKey } from "../src/source-key.js";

/** sourceKey 输出的合法字符集:定长 16 位小写十六进制。 */
const SOURCE_KEY_PATTERN = /^[0-9a-f]{16}$/;

describe("sourceKey — 同输入恒同输出", () => {
  it("同一 sourceId 多次派生结果一致", () => {
    const a = sourceKey("npm:@acme/crm-agent");
    const b = sourceKey("npm:@acme/crm-agent");
    expect(a).toBe(b);
  });

  it("builtin / git / npm 三型标识均可派生", () => {
    for (const id of [
      "builtin:default-agent",
      "https://github.com/user/repo",
      "npm:@acme/crm-agent",
    ]) {
      expect(sourceKey(id)).toMatch(SOURCE_KEY_PATTERN);
    }
  });
});

describe("sourceKey — 碰撞用例(不同 sourceId 派生不同 key)", () => {
  it("不同 source 名称派生不同 key", () => {
    const a = sourceKey("npm:@acme/crm-agent");
    const b = sourceKey("npm:@acme/erp-agent");
    expect(a).not.toBe(b);
  });

  it("相似但不同的标识(大小写/尾部差异)派生不同 key", () => {
    const a = sourceKey("npm:@acme/crm-agent");
    const b = sourceKey("npm:@acme/CRM-agent");
    const c = sourceKey("npm:@acme/crm-agent2");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("builtin 与同名 npm 标识不冲突(前缀参与散列)", () => {
    const a = sourceKey("builtin:crm-agent");
    const b = sourceKey("npm:crm-agent");
    expect(a).not.toBe(b);
  });
});

describe("sourceKey — 升版不丢配置(Req 0.2,拍板 Q2)", () => {
  it("同一 sourceId 在 version/channel 变化前后不变时,sourceKey 保持不变", () => {
    // sourceId 本身即「不含版本/channel」的稳定标识(如 PluginDescriptor.id);
    // 调用方在升版前后传入同一个 sourceId,sourceKey 天然不变——已存 per-source
    // 配置(以 sourceKey 为目录/主键)因此在升版后仍可命中。
    const sourceId = "npm:@acme/crm-agent";
    const beforeUpgrade = sourceKey(sourceId);
    const afterUpgrade = sourceKey(sourceId);
    expect(afterUpgrade).toBe(beforeUpgrade);
  });

  it("version/channel 差异不应影响 sourceKey(前提:调用方已从完整标识剥离版本再传入)", () => {
    // 模拟调用方(registry-client/resolvePiPlugin)在升版前后分别解析出的稳定 sourceId——
    // 即便完整来源标识含版本号差异,剥离后的 sourceId 相同,sourceKey 必然相同。
    const fullBefore = "npm:@acme/crm-agent@1.0.0#stable";
    const fullAfter = "npm:@acme/crm-agent@2.3.1#latest";
    const stripVersion = (full: string) => full.split("@").slice(0, -1).join("@") || full.split("@")[0] || full;
    const idBefore = stripVersion(fullBefore);
    const idAfter = stripVersion(fullAfter);
    expect(idBefore).toBe(idAfter);
    expect(sourceKey(idBefore)).toBe(sourceKey(idAfter));
  });
});

describe("sourceKey — 字符集安全 / 防路径注入(Req 0.3)", () => {
  it("输出仅含 16 位小写十六进制字符", () => {
    const key = sourceKey("npm:@acme/crm-agent");
    expect(key).toMatch(SOURCE_KEY_PATTERN);
    expect(isSourceKey(key)).toBe(true);
  });

  it("路径穿越型 sourceId(`../`)不影响输出形状,不产出穿越字符", () => {
    const key = sourceKey("../../etc/passwd");
    expect(key).toMatch(SOURCE_KEY_PATTERN);
    expect(key).not.toContain("..");
    expect(key).not.toContain("/");
  });

  it("含空字节/控制字符/特殊符号的 sourceId 输出仍安全", () => {
    const inputs = [
      "npm:@acme/crm-agent\0../secret",
      "source; rm -rf /",
      "..\\..\\windows\\system32",
      "npm:pkg?../../../etc",
      "a".repeat(5000), // 超长输入
    ];
    for (const id of inputs) {
      const key = sourceKey(id);
      expect(key).toMatch(SOURCE_KEY_PATTERN);
    }
  });

  it("unicode / 纯中文 sourceId 输出仍安全", () => {
    const key = sourceKey("npm:@厂商/代理");
    expect(key).toMatch(SOURCE_KEY_PATTERN);
  });

  it("空 sourceId(或仅空白)抛 TypeError(前置条件)", () => {
    expect(() => sourceKey("")).toThrow(TypeError);
    expect(() => sourceKey("   ")).toThrow(TypeError);
  });

  it("前后空白被 trim,不影响派生结果(与非空白部分等价)", () => {
    expect(sourceKey("  npm:@acme/crm-agent  ")).toBe(sourceKey("npm:@acme/crm-agent"));
  });
});

describe("isSourceKey — 形状校验", () => {
  it("合法 sourceKey 输出通过校验", () => {
    expect(isSourceKey(sourceKey("npm:@acme/crm-agent"))).toBe(true);
  });

  it("非法形状(长度/字符集/大小写)被拒绝", () => {
    expect(isSourceKey("../../etc/passwd")).toBe(false);
    expect(isSourceKey("ABCDEF0123456789")).toBe(false); // 大写非法
    expect(isSourceKey("0123abcd")).toBe(false); // 长度不足
    expect(isSourceKey("0123456789abcdef0")).toBe(false); // 过长
    expect(isSourceKey("")).toBe(false);
  });
});

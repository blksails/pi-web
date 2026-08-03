import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_MAX_VALUE_BYTES,
  WORKSPACE_MAX_VALUE_BYTES_ENV,
  WorkspaceConfigError,
  resolveWorkspaceValueLimit,
} from "../../src/workspace/limit-config.js";

/**
 * host-contract-ports 任务 2.2 —— 单键值上限的装配期解析(Req 3.1-3.3)。
 *
 * 分组沿用 `test/ai-gateway/config.test.ts` 的既有风格:缺省 / 合法 / 非法 fail-fast。
 */

const withEnv = (v?: string): NodeJS.ProcessEnv =>
  v === undefined ? {} : { [WORKSPACE_MAX_VALUE_BYTES_ENV]: v };

describe("缺省(Req 3.1)", () => {
  it("未设置 → 1 MiB", () => {
    expect(resolveWorkspaceValueLimit({})).toBe(DEFAULT_WORKSPACE_MAX_VALUE_BYTES);
    expect(DEFAULT_WORKSPACE_MAX_VALUE_BYTES).toBe(1_048_576);
  });

  it("空串/纯空白 → 视同未设置,取默认值而非报错", () => {
    // 空值常来自 CI 里的 `VAR=` 写法;把它当"未设置"比当"非法"更符合直觉。
    for (const v of ["", "   ", "\t", "\n"]) {
      expect(resolveWorkspaceValueLimit(withEnv(v))).toBe(DEFAULT_WORKSPACE_MAX_VALUE_BYTES);
    }
  });
});

describe("合法覆盖(Req 3.2)", () => {
  it("正整数 → 以该值为上限", () => {
    expect(resolveWorkspaceValueLimit(withEnv("2048"))).toBe(2048);
    expect(resolveWorkspaceValueLimit(withEnv("1"))).toBe(1);
    expect(resolveWorkspaceValueLimit(withEnv("8388608"))).toBe(8_388_608);
  });

  it("两侧空白被容忍", () => {
    expect(resolveWorkspaceValueLimit(withEnv("  4096  "))).toBe(4096);
  });

  it("JS 数字字面量记法被接受 —— 与既有 parsePositiveIntOverride 惯例一致", () => {
    // 既有 `ai-gateway/config.ts` 的正整数解析同样是 Number() + isInteger + >0,
    // 因而十六进制/八进制/二进制字面量天然被接受。此处显式钉住,避免日后有人以
    // "更严格" 为由改成 parseInt —— 那会引入静默吞掉单位后缀的缺陷(见下方用例)。
    expect(resolveWorkspaceValueLimit(withEnv("0x10"))).toBe(16);
    expect(resolveWorkspaceValueLimit(withEnv("1e3"))).toBe(1000);
  });
});

describe("非法即抛,不静默回落默认(Req 3.3)", () => {
  const expectConfigError = (v: string): WorkspaceConfigError => {
    let caught: unknown;
    try {
      resolveWorkspaceValueLimit(withEnv(v));
    } catch (err) {
      caught = err;
    }
    expect(caught, `expected ${JSON.stringify(v)} to be rejected`).toBeInstanceOf(
      WorkspaceConfigError,
    );
    return caught as WorkspaceConfigError;
  };

  it("非数字被拒", () => {
    for (const v of ["abc", "1e", "--1", "12a", "1,024", "1_024"]) expectConfigError(v);
  });

  it("★ 带单位后缀被拒 —— 不得像 parseInt 那样静默吞掉后缀", () => {
    // "1MB" 若被解析成 1,系统会以 1 字节上限运行且无任何信号,几乎所有写入都被拒,
    // 而运维完全看不出是这行配置的问题。
    for (const v of ["1MB", "1024KB", "10mb", "5 bytes"]) expectConfigError(v);
  });

  it("小数被拒", () => {
    for (const v of ["1.5", "1024.0001", "0.5"]) expectConfigError(v);
  });

  it("零与负数被拒", () => {
    for (const v of ["0", "-1", "-1024"]) expectConfigError(v);
  });

  it("Infinity / NaN 被拒", () => {
    for (const v of ["Infinity", "-Infinity", "NaN"]) expectConfigError(v);
  });

  it("错误携带 env 名与原值,使运维无需读代码即可定位", () => {
    const e = expectConfigError("1MB");
    expect(e.name).toBe("WorkspaceConfigError");
    expect(e.source).toBe(WORKSPACE_MAX_VALUE_BYTES_ENV);
    expect(e.rawValue).toBe("1MB");
    expect(e.message).toContain(WORKSPACE_MAX_VALUE_BYTES_ENV);
    expect(e.message).toContain("1MB");
  });

  it("装配期错误不并入运行期四类判别码", () => {
    // WorkspaceConfigError 应导致启动失败,不应被当作可降级的运行期存储故障捕获,
    // 故刻意不带 key/limit/corrupt/io 之一。
    const e = expectConfigError("0") as unknown as { code?: unknown };
    expect(e.code).toBeUndefined();
  });
});

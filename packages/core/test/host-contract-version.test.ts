import { describe, expect, it } from "vitest";
import {
  HOST_CONTRACT_VERSION,
  HostContractVersionError,
  assertHostContractVersion,
} from "../src/host-contract-version.js";

/**
 * host-contract-ports 任务 1.2 —— 契约版本常量与装配期版本自检(Req 9.1-9.3)。
 */
describe("宿主契约版本(Req 9.1)", () => {
  it("暴露可被程序读取的版本标识", () => {
    expect(HOST_CONTRACT_VERSION).toBe(1);
  });
});

describe("装配期版本自检(Req 9.2)", () => {
  it("版本一致 → 静默返回", () => {
    expect(() => assertHostContractVersion(HOST_CONTRACT_VERSION)).not.toThrow();
  });

  it("版本不一致 → 抛错并携带双方版本号", () => {
    let caught: unknown;
    try {
      assertHostContractVersion(2);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(HostContractVersionError);
    const e = caught as HostContractVersionError;
    expect(e.expected).toBe(HOST_CONTRACT_VERSION);
    expect(e.actual).toBe(2);
    expect(e.name).toBe("HostContractVersionError");
    // message 须同时含两个版本号,便于跨仓排障时无需断点即可定位。
    expect(e.message).toContain(String(HOST_CONTRACT_VERSION));
    expect(e.message).toContain("2");
  });

  it("判定为严格相等 —— 更低版本同样拒绝(不做向下兼容分支,Req 9.3)", () => {
    // 契约 §1:同版本内只允许增量演进;版本号一变即不兼容,无「≥ 即可」的语义。
    expect(() => assertHostContractVersion(0)).toThrow(HostContractVersionError);
    expect(() => assertHostContractVersion(2)).toThrow(HostContractVersionError);
  });

  it("非整数/NaN 同样被拒绝(不静默放行)", () => {
    expect(() => assertHostContractVersion(1.5)).toThrow(HostContractVersionError);
    expect(() => assertHostContractVersion(Number.NaN)).toThrow(HostContractVersionError);
  });
});

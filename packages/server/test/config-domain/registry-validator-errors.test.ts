import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { FormSchema } from "@blksails/pi-web-protocol";
import {
  ConfigDomainRegistrationError,
  createConfigDomainRegistry,
} from "../../src/config-domain/index.js";
import type { ConfigDomainDescriptor } from "../../src/config-domain/index.js";

/**
 * host-contract-ports 任务 5.3（复核补充）—— 键校验层抛出的**非键错误**不得被转译。
 *
 * 为什么单开一个文件:本文件覆盖了 `workspace/key.js` 的 `validateWorkspaceKey`,真实校验
 * 逻辑在此不再生效;与 `registry.test.ts`(验真实校验行为)放同一文件会互相污染。
 *
 * 判别力:对「无区分捕获」(`catch (cause) { throw new ConfigDomainRegistrationError(...) }`)
 * 的实现,第一条用例必转红——那种实现会把 `TypeError` 包成 `invalid-id`。
 */
const validateWorkspaceKey = vi.hoisted(() => vi.fn<(key: string) => void>());

// 保留原模块、只覆盖 `validateWorkspaceKey` 这一个导出:`assertWorkspaceKey` 及将来任何
// 新增导出都自动跟随真实实现,不必在此逐个补桩(整模块 mock 会让本文件与 key.js 的导出
// 清单产生维护耦合)。判别力不变——`registry.ts` 只用 `validateWorkspaceKey`。
vi.mock("../../src/workspace/key.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/workspace/key.js")>()),
  validateWorkspaceKey,
}));

function descriptor(id: string): ConfigDomainDescriptor {
  return {
    id,
    schema: z.object({}),
    formSchema: { domain: id, fields: [] } satisfies FormSchema,
  };
}

function catchError(fn: () => void): unknown {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err;
  }
}

beforeEach(() => {
  validateWorkspaceKey.mockReset();
});

describe("键校验层的错误按「是什么」分类,不按「在哪发生」分类", () => {
  it("校验器抛出非键错误(实现故障)→ 原样上抛,不被贴上 invalid-id", () => {
    const boom = new TypeError("validator itself is broken");
    validateWorkspaceKey.mockImplementation(() => {
      throw boom;
    });
    const registry = createConfigDomainRegistry();

    const err = catchError(() => registry.register(descriptor("auth")));

    // 无区分捕获的实现在此得到 ConfigDomainRegistrationError/"invalid-id",即把实现缺陷
    // 伪装成调用方的输入错误。
    expect(err).toBe(boom);
    expect(err).not.toBeInstanceOf(ConfigDomainRegistrationError);
    // 上抛不等于放行:失败的注册仍不得留下痕迹。
    expect(registry.list()).toEqual([]);
  });

  it("校验器抛出键错误(code=\"key\")→ 仍转译为 invalid-id 并保留 cause 链", () => {
    // 刻意用一个**非** WorkspaceKeyError 实例、只带稳定判别码的对象:证明分类走的是
    // `code`,而不是 `instanceof`(跨包 instanceof 会假阴性,契约勘误①)。
    const keyErr = Object.assign(new Error("invalid workspace key"), { code: "key" as const });
    validateWorkspaceKey.mockImplementation(() => {
      throw keyErr;
    });
    const registry = createConfigDomainRegistry();

    const err = catchError(() => registry.register(descriptor("auth")));

    expect(err).toBeInstanceOf(ConfigDomainRegistrationError);
    expect((err as ConfigDomainRegistrationError).code).toBe("invalid-id");
    expect((err as ConfigDomainRegistrationError).id).toBe("auth");
    expect((err as ConfigDomainRegistrationError).cause).toBe(keyErr);
    expect(registry.list()).toEqual([]);
  });

  it("校验器通过时 → 正常注册(确认 mock 未把整条路径短路)", () => {
    validateWorkspaceKey.mockImplementation(() => {});
    const registry = createConfigDomainRegistry();

    registry.register(descriptor("auth"));

    expect(registry.list().map((d) => d.id)).toEqual(["auth"]);
  });
});

import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  authConfigSchema,
  authFormSchema,
  loggingConfigSchema,
  loggingFormSchema,
  sandboxConfigSchema,
  sandboxFormSchema,
  settingsConfigSchema,
  settingsFormSchema,
} from "@blksails/pi-web-protocol";
import type { FormSchema } from "@blksails/pi-web-protocol";
import {
  ConfigDomainRegistrationError,
  createConfigDomainRegistry,
  registerHostConfigDomains,
} from "../../src/config-domain/index.js";
import type { ConfigDomainDescriptor } from "../../src/config-domain/index.js";

/**
 * host-contract-ports 任务 5.3 —— 配置域注册表与宿主默认域(Req 7.1-7.5)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §6。
 */

/** 造一个可辨识的描述符:`schema` 用 literal 使不同 id 的描述符互不相等。 */
function descriptor(id: string, marker = id): ConfigDomainDescriptor {
  return {
    id,
    schema: z.object({ marker: z.literal(marker) }),
    formSchema: { domain: id, title: marker, fields: [] } satisfies FormSchema,
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

describe("注册后立即可查询与列举(Req 7.1)", () => {
  it("register 之后 get 与 list 立即可见,且返回同一描述符", () => {
    const registry = createConfigDomainRegistry();
    const d = descriptor("quota");

    expect(registry.get("quota")).toBeUndefined();
    expect(registry.list()).toEqual([]);

    registry.register(d);

    expect(registry.get("quota")).toBe(d);
    expect(registry.list()).toEqual([d]);
  });

  it("未注册的 id → get 返回 undefined(不抛)", () => {
    const registry = createConfigDomainRegistry();
    registry.register(descriptor("quota"));
    expect(registry.get("desktop-prefs")).toBeUndefined();
  });
});

describe("列举顺序按注册顺序稳定(Req 7.1)", () => {
  /**
   * 判别力说明:三个 id 刻意选成
   *  - 含**整数形态**的 id(`"10"`/`"2"`):以普通对象为底、走 `Object.keys` 的实现会把
   *    整数键提前并按数值升序 → `["2","10","auth"]`;
   *  - 注册顺序既非字典序也非数值序:走 `Set` + 排序或字典序的实现 → `["10","2","auth"]`。
   * 三者互不相同,故本断言对上述任一错误实现都转红。
   */
  it("整数形态与字母 id 混排时,list 仍按注册顺序", () => {
    const registry = createConfigDomainRegistry();
    registry.register(descriptor("auth"));
    registry.register(descriptor("10"));
    registry.register(descriptor("2"));

    expect(registry.list().map((d) => d.id)).toEqual(["auth", "10", "2"]);
  });

  it("失败的注册不改变既有顺序", () => {
    const registry = createConfigDomainRegistry();
    registry.register(descriptor("auth"));
    expect(catchError(() => registry.register(descriptor("a/b")))).toBeInstanceOf(
      ConfigDomainRegistrationError,
    );
    registry.register(descriptor("logging"));

    expect(registry.list().map((d) => d.id)).toEqual(["auth", "logging"]);
  });
});

describe("重复标识抛错而非静默覆盖(Req 7.2)", () => {
  it("同 id 二次注册 → 抛 code=duplicate 并携带 id", () => {
    const registry = createConfigDomainRegistry();
    registry.register(descriptor("auth", "first"));

    const err = catchError(() => registry.register(descriptor("auth", "second")));

    expect(err).toBeInstanceOf(ConfigDomainRegistrationError);
    expect((err as ConfigDomainRegistrationError).code).toBe("duplicate");
    expect((err as ConfigDomainRegistrationError).id).toBe("auth");
  });

  it("重复注册后,先注册者仍是权威且不产生第二条记录", () => {
    const registry = createConfigDomainRegistry();
    const first = descriptor("auth", "first");
    registry.register(first);
    catchError(() => registry.register(descriptor("auth", "second")));

    // 静默覆盖(后写者胜)与「抛错但仍写入」都会在此转红。
    expect(registry.get("auth")).toBe(first);
    expect(registry.list()).toEqual([first]);
  });
});

describe("标识须满足键空间规则且不含分隔符(Req 7.5)", () => {
  const illegal: ReadonlyArray<readonly [string, string]> = [
    ["空串", ""],
    ["含分隔符(键空间本身合法,故必须由额外的单段约束拦下)", "sources/settings"],
    ["尾随分隔符", "auth/"],
    ["前导分隔符(绝对路径)", "/auth"],
    ["相对段", ".."],
    ["当前段", "."],
    ["反斜杠", "a\\b"],
    ["空字符", "a\0b"],
  ];

  for (const [label, id] of illegal) {
    it(`非法 id → 抛 code=invalid-id:${label}`, () => {
      const registry = createConfigDomainRegistry();
      const err = catchError(() => registry.register(descriptor(id)));

      expect(err).toBeInstanceOf(ConfigDomainRegistrationError);
      expect((err as ConfigDomainRegistrationError).code).toBe("invalid-id");
      expect((err as ConfigDomainRegistrationError).id).toBe(id);
      // 拒绝必须发生在写入之前:注册表保持空。
      expect(registry.list()).toEqual([]);
    });
  }

  it("非字符串 id → 同样按 invalid-id 拒绝(不落入 duplicate/静默接受)", () => {
    const registry = createConfigDomainRegistry();
    const err = catchError(() =>
      registry.register({ ...descriptor("x"), id: 42 as unknown as string }),
    );

    expect(err).toBeInstanceOf(ConfigDomainRegistrationError);
    expect((err as ConfigDomainRegistrationError).code).toBe("invalid-id");
    expect(registry.list()).toEqual([]);
  });

  it("合法的多形态单段 id 被接受(边界另一侧,防止校验过严)", () => {
    const registry = createConfigDomainRegistry();
    for (const id of ["auth", "desktop-prefs", "cloud_quota", "a.b", "10"]) {
      expect(() => registry.register(descriptor(id))).not.toThrow();
    }
    expect(registry.list()).toHaveLength(5);
  });
});

describe("默认只注册宿主关切的四个域(Req 7.3/7.4)", () => {
  it("默认注册集**恰为**四个宿主域,顺序稳定", () => {
    const registry = createConfigDomainRegistry();
    registerHostConfigDomains(registry);

    // 全等断言同时抓住「多注册」(含任何工具领域域)与「少注册」。
    expect(registry.list().map((d) => d.id)).toEqual(["auth", "settings", "sandbox", "logging"]);
  });

  it("不注册任何工具领域的域:aigc 不可查询(Req 7.4)", () => {
    const registry = createConfigDomainRegistry();
    registerHostConfigDomains(registry);
    expect(registry.get("aigc")).toBeUndefined();
  });

  it("四个域各自挂的是既有 protocol 的 zod 与表单 IR(不是占位对象)", () => {
    const registry = createConfigDomainRegistry();
    registerHostConfigDomains(registry);

    expect(registry.get("auth")?.schema).toBe(authConfigSchema);
    expect(registry.get("auth")?.formSchema).toBe(authFormSchema);
    expect(registry.get("settings")?.schema).toBe(settingsConfigSchema);
    expect(registry.get("settings")?.formSchema).toBe(settingsFormSchema);
    expect(registry.get("sandbox")?.schema).toBe(sandboxConfigSchema);
    expect(registry.get("sandbox")?.formSchema).toBe(sandboxFormSchema);
    expect(registry.get("logging")?.schema).toBe(loggingConfigSchema);
    expect(registry.get("logging")?.formSchema).toBe(loggingFormSchema);
  });

  it("宿主可在默认域之外追加自有域(Req 7.1),追加后默认域不受影响", () => {
    const registry = createConfigDomainRegistry();
    registerHostConfigDomains(registry);
    registry.register(descriptor("cloud-quota"));

    expect(registry.list().map((d) => d.id)).toEqual([
      "auth",
      "settings",
      "sandbox",
      "logging",
      "cloud-quota",
    ]);
  });

  it("对已含同名域的注册表再注册默认集 → duplicate 抛错(不静默覆盖)", () => {
    const registry = createConfigDomainRegistry();
    const mine = descriptor("settings", "mine");
    registry.register(mine);

    const err = catchError(() => registerHostConfigDomains(registry));

    expect(err).toBeInstanceOf(ConfigDomainRegistrationError);
    expect((err as ConfigDomainRegistrationError).code).toBe("duplicate");
    expect((err as ConfigDomainRegistrationError).id).toBe("settings");
    expect(registry.get("settings")).toBe(mine);
  });
});

import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  settingsConfigSchema,
  authConfigSchema,
  secretSet,
  secretKeep,
  secretClear,
} from "@blksails/protocol";
import {
  useSchemaForm,
  zodValidator,
  secretAwareValidator,
} from "../../src/config/use-schema-form.js";

describe("zodValidator", () => {
  const validate = zodValidator(settingsConfigSchema);

  it("合法值通过", () => {
    const r = validate({ theme: "dark" });
    expect(r.ok).toBe(true);
  });

  it("非法枚举映射为点路径错误", () => {
    const r = validate({ theme: "neon" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.theme).toBeDefined();
  });
});

describe("secretAwareValidator(auth)", () => {
  const validate = secretAwareValidator(authConfigSchema);

  it("含 SecretWrite(set/keep) 的 auth 值通过,且返回原始表单值", () => {
    const values = {
      anthropic: { apiKey: secretSet("sk-123") },
      openai: { apiKey: secretKeep },
    };
    const r = validate(values);
    expect(r.ok).toBe(true);
    // 成功时返回原始值(仍含 SecretWrite),以便 PUT 交服务端权威合并
    if (r.ok) expect(r.values).toBe(values);
  });

  it("空的新密钥(set 空串)被拦截", () => {
    const r = validate({ anthropic: { apiKey: secretSet("") } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors["anthropic.apiKey"]).toBeDefined();
  });

  it("掩码态(已设置)通过校验", () => {
    const r = validate({
      anthropic: { apiKey: { __secret: true, set: true, hint: "1234" } },
    });
    expect(r.ok).toBe(true);
  });

  it("clear 使该 provider 缺失必填 apiKey → 报错", () => {
    const r = validate({ anthropic: { apiKey: secretClear } });
    expect(r.ok).toBe(false);
  });
});

describe("useSchemaForm", () => {
  it("setValue 支持嵌套点路径", () => {
    const { result } = renderHook(() => useSchemaForm({ initialValues: {} }));
    act(() => result.current.setValue(["a", "b"], "x"));
    expect((result.current.values.a as Record<string, unknown>).b).toBe("x");
  });

  it("submit 校验失败置入 errors 且不产出值", () => {
    const { result } = renderHook(() =>
      useSchemaForm({
        initialValues: { theme: "neon" },
        validate: zodValidator(settingsConfigSchema),
      }),
    );
    let ok = true;
    act(() => {
      ok = result.current.submit().ok;
    });
    expect(ok).toBe(false);
    expect(result.current.errors.theme).toBeDefined();
  });

  it("dirty 随修改翻转", () => {
    const { result } = renderHook(() =>
      useSchemaForm({ initialValues: { theme: "system" } }),
    );
    expect(result.current.dirty).toBe(false);
    act(() => result.current.setValues({ theme: "dark" }));
    expect(result.current.dirty).toBe(true);
  });
});

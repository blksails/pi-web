import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { settingsConfigSchema } from "@pi-web/protocol";
import {
  useSchemaForm,
  zodValidator,
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

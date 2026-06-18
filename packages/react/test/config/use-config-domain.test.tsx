import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { settingsConfigSchema } from "@pi-web/protocol";
import { zodValidator } from "../../src/config/use-schema-form.js";
import {
  useConfigDomain,
  makeConfigDomainIO,
} from "../../src/config/use-config-domain.js";

describe("useConfigDomain", () => {
  it("加载填值,保存调用 panel.save", async () => {
    const save = vi.fn(async () => undefined);
    const panel = {
      load: async () => ({ theme: "dark" }),
      save,
      validate: zodValidator(settingsConfigSchema),
    };
    const { result } = renderHook(() => useConfigDomain(panel));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.form.values.theme).toBe("dark");

    act(() => result.current.form.setValues({ theme: "light" }));
    await act(async () => {
      await result.current.save();
    });
    expect(save).toHaveBeenCalledWith({ theme: "light" });
    expect(result.current.saved).toBe(true);
  });

  it("校验失败不调用 save", async () => {
    const save = vi.fn(async () => undefined);
    const panel = {
      load: async () => ({ theme: "system" }),
      save,
      validate: zodValidator(settingsConfigSchema),
    };
    const { result } = renderHook(() => useConfigDomain(panel));
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.form.setValues({ theme: "neon" }));
    await act(async () => {
      await result.current.save();
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.form.errors.theme).toBeDefined();
  });

  it("加载错误置 loadError", async () => {
    const panel = {
      load: async () => {
        throw new Error("boom");
      },
      save: async () => undefined,
    };
    const { result } = renderHook(() => useConfigDomain(panel));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.loadError).toBe("boom");
  });
});

describe("makeConfigDomainIO", () => {
  it("load GET 取 values,save PUT 提交 {values}", async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if ((init?.method ?? "GET") === "GET") {
        return new Response(JSON.stringify({ values: { theme: "dark" } }), {
          status: 200,
        });
      }
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const io = makeConfigDomainIO("settings", { baseUrl: "/api", fetchImpl });
    expect(await io.load()).toEqual({ theme: "dark" });
    await io.save({ theme: "light" });
    expect(fetchImpl).toHaveBeenLastCalledWith(
      "/api/config/settings",
      expect.objectContaining({ method: "PUT" }),
    );
  });
});

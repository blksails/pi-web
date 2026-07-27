/**
 * 登录门禁(spec: desktop-account-login,Req 10)。
 *
 * ★ 本文件真正的价值不在「未登录会拦」,而在**三条不拦的路径**:
 *   - 云端未配置(`disabled`)→ 放行。拦了等于把纯本地用法与浏览器用法整个废掉。
 *   - `canExchange:false`(云端多租户宿主)→ 放行。身份由它自身路径处理。
 *   - `loading` → 既不拦也不放行(渲染空白)。先闪一下登录页再跳走比空白更糟。
 *
 * 前者若被写错,故障形态是「没配云端的用户打开就是一块永远登不进去的登录页」——
 * 而那是绝大多数本地开发者的使用形态。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { IdentityGate, LoginPage } from "../../components/auth/login-page.js";
import { IdentityStateProvider } from "../../components/auth/use-identity.js";

const TENANT = { userId: "u1", companyId: "c1", role: "member" };
const MAIN = "main-app-content";

function mountGate(body: unknown, status = 200): void {
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/api/identity") && (init?.method ?? "GET") === "GET") {
      if (status !== 200) return new Response("", { status });
      return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  render(
    <IdentityStateProvider>
      <IdentityGate>
        <div data-testid={MAIN}>主页面</div>
      </IdentityGate>
    </IdentityStateProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("★ 不拦的三条路径", () => {
  it("云端未配置(GET 404 → disabled)→ **放行**,主页面照常可用", async () => {
    mountGate(undefined, 404);
    await waitFor(() => expect(screen.getByTestId(MAIN)).toBeTruthy());
    expect(screen.queryByTestId("login-page")).toBeNull();
  });

  it("探测失败(fetch 抛)→ **放行**,不因网络问题把人关在门外", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    render(
      <IdentityStateProvider>
        <IdentityGate>
          <div data-testid={MAIN}>主页面</div>
        </IdentityGate>
      </IdentityStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId(MAIN)).toBeTruthy());
  });

  it("anonymous 且 canExchange=false(云端多租户宿主)→ **放行**", async () => {
    mountGate({ state: "anonymous", canExchange: false });
    await waitFor(() => expect(screen.getByTestId(MAIN)).toBeTruthy());
    expect(screen.queryByTestId("login-page")).toBeNull();
  });
});

describe("拦的路径", () => {
  it("anonymous 且 canExchange=true → 渲染登录页,主页面**不**挂载", async () => {
    mountGate({ state: "anonymous", canExchange: true });
    await waitFor(() => expect(screen.getByTestId("login-page")).toBeTruthy());
    expect(screen.queryByTestId(MAIN)).toBeNull();
    // 登录页里是账号密码表单,不是粘贴框。
    expect(screen.getByTestId("login-email")).toBeTruthy();
    expect(screen.getByTestId("login-password")).toBeTruthy();
  });

  it("loading 期间既不渲染登录页也不渲染主页面(不闪)", () => {
    // fetch 永不 resolve → 停在 loading。
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(
      <IdentityStateProvider>
        <IdentityGate>
          <div data-testid={MAIN}>主页面</div>
        </IdentityGate>
      </IdentityStateProvider>,
    );
    expect(screen.queryByTestId("login-page")).toBeNull();
    expect(screen.queryByTestId(MAIN)).toBeNull();
  });

  it("authenticated → 放行", async () => {
    mountGate({ state: "authenticated", tenant: TENANT, canExchange: true });
    await waitFor(() => expect(screen.getByTestId(MAIN)).toBeTruthy());
    expect(screen.queryByTestId("login-page")).toBeNull();
  });
});

describe("LoginPage 自身", () => {
  it("独立页布局**不渲染取消按钮**(没有可返回之处)", async () => {
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ state: "anonymous", canExchange: true }), { status: 200 }),
    );
    render(
      <IdentityStateProvider>
        <LoginPage />
      </IdentityStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("login-form")).toBeTruthy());
    expect(screen.queryByTestId("login-cancel")).toBeNull();
  });
});

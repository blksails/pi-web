/**
 * 身份状态投影(spec: desktop-account-login,任务 7.5;Req 1.5/2.5/5.1/5.3/7.1)。
 *
 * 移植自 `desktop-auth-shared-refresh.test.tsx`(旧 useDesktopAuth 已随本 spec 删除):
 * 守卫「LoginControl 与列表刷新消费**同一** Provider;身份变化 → refreshSignal bump」。
 * 这条守卫的价值是防回归 —— 各挂各的 Provider 时,登录后侧栏不会重拉源列表。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import {
  IdentityStateProvider,
  identityListKey,
  useIdentity,
  type IdentityUiState,
} from "../../components/auth/use-identity.js";

const TENANT = { userId: "u1", companyId: "c1", role: "member" };

interface FetchCall {
  readonly url: string;
  readonly method: string;
  readonly body?: string;
}

let calls: FetchCall[] = [];
let identityBody: unknown = { state: "anonymous", canExchange: true };
let identityStatus = 200;
let exchangeStatus = 200;

function installFetch(): void {
  calls = [];
  vi.stubGlobal("fetch", async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url.includes("/api/identity/exchange")) {
      if (exchangeStatus !== 200) {
        return new Response(JSON.stringify({ code: "EXCHANGE_FAILED" }), {
          status: exchangeStatus,
        });
      }
      identityBody = { state: "authenticated", tenant: TENANT, canExchange: true };
      return new Response(JSON.stringify(identityBody), { status: 200 });
    }
    if (url.includes("/api/identity")) {
      if (method === "DELETE") {
        identityBody = { state: "anonymous", canExchange: true };
        return new Response(JSON.stringify(identityBody), { status: 200 });
      }
      if (identityStatus !== 200) return new Response("", { status: identityStatus });
      return new Response(JSON.stringify(identityBody), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
}

beforeEach(() => {
  identityBody = { state: "anonymous", canExchange: true };
  identityStatus = 200;
  exchangeStatus = 200;
  installFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identityListKey(纯函数)", () => {
  it.each([
    [{ kind: "loading" } as IdentityUiState, "no-identity"],
    [{ kind: "disabled" } as IdentityUiState, "no-identity"],
    [{ kind: "anonymous", canExchange: true } as IdentityUiState, "no-identity"],
  ])("非已认证态一律 no-identity", (state, expected) => {
    expect(identityListKey(state)).toBe(expected);
  });

  it("★ 含 userId/companyId —— 切用户或公司必须改变取值", () => {
    const a: IdentityUiState = {
      kind: "authenticated",
      tenant: { ...TENANT, userId: "a" },
      canExchange: true,
    };
    const b: IdentityUiState = {
      kind: "authenticated",
      tenant: { ...TENANT, userId: "b" },
      canExchange: true,
    };
    expect(identityListKey(a)).not.toBe(identityListKey(b));
    expect(identityListKey(a)).toBe("identity:a:c1");
  });

  it("同一用户切公司时必须改变取值,以重建持凭据 runner", () => {
    const companyA: IdentityUiState = {
      kind: "authenticated",
      tenant: { ...TENANT, companyId: "company-a" },
      canExchange: true,
    };
    const companyB: IdentityUiState = {
      kind: "authenticated",
      tenant: { ...TENANT, companyId: "company-b" },
      canExchange: true,
    };
    expect(identityListKey(companyA)).not.toBe(identityListKey(companyB));
  });
});

function Probe(props: { readonly onKey: (k: string) => void }): React.JSX.Element {
  const identity = useIdentity();
  const key = identityListKey(identity.state);
  React.useEffect(() => {
    props.onKey(key);
  }, [key, props]);
  return (
    <div>
      <span data-testid="kind">{identity.state.kind}</span>
      <button
        type="button"
        data-testid="do-exchange"
        onClick={() => void identity.exchange("13800138000", "pw")}
      />
      <button type="button" data-testid="do-revoke" onClick={() => void identity.revoke()} />
    </div>
  );
}

describe("共享 Provider → 身份变化驱动列表刷新", () => {
  it("登录 → 登出,identityListKey 两次变化", async () => {
    const keys: string[] = [];
    render(
      <IdentityStateProvider>
        <Probe onKey={(k) => keys.push(k)} />
      </IdentityStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("kind").textContent).toBe("anonymous"));

    await act(async () => {
      screen.getByTestId("do-exchange").click();
    });
    await waitFor(() => expect(screen.getByTestId("kind").textContent).toBe("authenticated"));
    expect(keys).toContain("identity:u1:c1");

    await act(async () => {
      screen.getByTestId("do-revoke").click();
    });
    await waitFor(() => expect(screen.getByTestId("kind").textContent).toBe("anonymous"));
    expect(keys.filter((k) => k === "no-identity").length).toBeGreaterThanOrEqual(2);
  });

  it("两个 useIdentity 消费者见同一状态(共享 Provider)", async () => {
    function Two(): React.JSX.Element {
      const a = useIdentity();
      const b = useIdentity();
      return (
        <>
          <span data-testid="a">{a.state.kind}</span>
          <span data-testid="b">{b.state.kind}</span>
          <button
            type="button"
            data-testid="go"
            onClick={() => void a.exchange("13800138000", "pw")}
          />
        </>
      );
    }
    render(
      <IdentityStateProvider>
        <Two />
      </IdentityStateProvider>,
    );
    await act(async () => {
      screen.getByTestId("go").click();
    });
    await waitFor(() => expect(screen.getByTestId("a").textContent).toBe("authenticated"));
    expect(screen.getByTestId("b").textContent).toBe("authenticated");
  });

  it("Provider 之外调用 useIdentity 直接抛(防止有人各挂各的)", () => {
    function Bare(): React.JSX.Element {
      useIdentity();
      return <div />;
    }
    expect(() => render(<Bare />)).toThrow(/IdentityStateProvider/);
  });
});

describe("四态判定", () => {
  it("GET 404(能力面未挂载)→ disabled(Req 2.5)", async () => {
    identityStatus = 404;
    render(
      <IdentityStateProvider>
        <Probe onKey={() => {}} />
      </IdentityStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("kind").textContent).toBe("disabled"));
  });

  it("网络异常 → disabled 而非崩溃(Req 1.6)", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error("offline");
    });
    render(
      <IdentityStateProvider>
        <Probe onKey={() => {}} />
      </IdentityStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("kind").textContent).toBe("disabled"));
  });

  it("authenticated 但 tenant 缺 userId → 按 anonymous 处理,不渲染空用户名", async () => {
    identityBody = { state: "authenticated", tenant: {}, canExchange: true };
    render(
      <IdentityStateProvider>
        <Probe onKey={() => {}} />
      </IdentityStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("kind").textContent).toBe("anonymous"));
  });

  it("tenant 缺 companyId/role → 退回空串,身份仍成立(Req 5.3)", async () => {
    identityBody = { state: "authenticated", tenant: { userId: "u9" }, canExchange: false };
    function Show(): React.JSX.Element {
      const s = useIdentity().state;
      return <span data-testid="v">{s.kind === "authenticated" ? `${s.tenant.userId}|${s.tenant.companyId}|${s.tenant.role}` : s.kind}</span>;
    }
    render(
      <IdentityStateProvider>
        <Show />
      </IdentityStateProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("u9||"));
  });
});

describe("exchange 请求形状与失败分类", () => {
  it("手机密码 POST /api/identity/exchange,体含 method/phone/password", async () => {
    render(
      <IdentityStateProvider>
        <Probe onKey={() => {}} />
      </IdentityStateProvider>,
    );
    await act(async () => {
      screen.getByTestId("do-exchange").click();
    });
    const post = calls.find((c) => c.url.includes("/exchange"));
    expect(post?.method).toBe("POST");
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      method: "password",
      phone: "13800138000",
      password: "pw",
    });
  });

  it("邮箱密码 POST /api/identity/exchange,体含 method/email/password", async () => {
    function EmailProbe(): React.JSX.Element {
      const identity = useIdentity();
      return (
        <button
          type="button"
          data-testid="do-email-exchange"
          onClick={() => void identity.exchange(" user@example.com ", "pw")}
        />
      );
    }
    render(
      <IdentityStateProvider>
        <EmailProbe />
      </IdentityStateProvider>,
    );
    await act(async () => {
      screen.getByTestId("do-email-exchange").click();
    });
    const post = calls.find((c) => c.url.includes("/exchange"));
    expect(JSON.parse(post?.body ?? "{}")).toEqual({
      method: "password",
      email: "user@example.com",
      password: "pw",
    });
  });

  it.each([
    [401, "invalid-credentials"],
    [400, "invalid-request"],
    [405, "unsupported"],
    [502, "cloud-unreachable"],
  ])("HTTP %d → reason %s", async (status, reason) => {
    exchangeStatus = status;
    let got: string | undefined;
    function Runner(): React.JSX.Element {
      const identity = useIdentity();
      return (
        <button
          type="button"
          data-testid="go"
          onClick={() => {
            void identity.exchange("13800138000", "pw").then((r) => {
              got = r.reason;
            });
          }}
        />
      );
    }
    render(
      <IdentityStateProvider>
        <Runner />
      </IdentityStateProvider>,
    );
    await act(async () => {
      screen.getByTestId("go").click();
    });
    await waitFor(() => expect(got).toBe(reason));
  });
});

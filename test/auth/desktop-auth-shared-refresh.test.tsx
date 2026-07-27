/**
 * desktop-hybrid-agent-sources · 共享登录态 → agent-sources 刷新。
 *
 * 守卫:LoginControl 与列表刷新消费**同一** DesktopAuthProvider;login/logout 后
 * desktopAuthListIdentity 变化 → refreshSignal bump → listAgentSources 再调。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  DesktopAuthProvider,
  desktopAuthListIdentity,
  useDesktopAuth,
} from "../../components/auth/use-desktop-auth.js";
import { LoginControl } from "../../components/auth/login-control.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockAuthFetch(opts: {
  me: { loggedIn: false } | {
    loggedIn: true;
    userId: string;
    companyId: string;
    exp: number;
    status: "valid";
  };
  loginOk?: boolean;
}): { fetchMock: ReturnType<typeof vi.fn>; meCalls: () => number } {
  let me = opts.me;
  let meCalls = 0;
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/auth/me") && method === "GET") {
      meCalls += 1;
      return new Response(JSON.stringify(me), { status: 200 });
    }
    if (url.includes("/api/auth/session") && method === "POST") {
      if (opts.loginOk === false) {
        return new Response("{}", { status: 401 });
      }
      me = {
        loggedIn: true,
        userId: "user-1",
        companyId: "co-1",
        exp: 9_999_999_999,
        status: "valid",
      };
      return new Response("{}", { status: 200 });
    }
    if (url.includes("/api/auth/session") && method === "DELETE") {
      me = { loggedIn: false };
      return new Response("{}", { status: 200 });
    }
    return new Response("not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, meCalls: () => meCalls };
}

/** 模拟 ChatApp 内:共享 auth + refreshKey + listAgentSources 随 refresh 重拉。 */
function AuthListHarness(props: {
  readonly listAgentSources: (req: unknown) => Promise<{ sources: unknown[] }>;
}): React.JSX.Element {
  const auth = useDesktopAuth();
  const identity = desktopAuthListIdentity(auth);
  const [refreshKey, setRefreshKey] = React.useState(0);
  React.useEffect(() => {
    setRefreshKey((n) => n + 1);
  }, [identity]);

  React.useEffect(() => {
    void props.listAgentSources({ refreshKey });
  }, [refreshKey, props.listAgentSources]);

  return (
    <div>
      <LoginControl />
      <span data-testid="refresh-key">{refreshKey}</span>
      <span data-testid="auth-identity">{identity}</span>
      <span data-testid="logged-in">{String(auth.loggedIn)}</span>
    </div>
  );
}

describe("desktopAuthListIdentity (pure)", () => {
  it("登录/登出/切号产生不同键", () => {
    expect(desktopAuthListIdentity({ loggedIn: false })).toBe("logged-out");
    expect(desktopAuthListIdentity({ loggedIn: true, userId: "a" })).toBe(
      "logged-in:a",
    );
    expect(desktopAuthListIdentity({ loggedIn: true, userId: "b" })).toBe(
      "logged-in:b",
    );
  });
});

describe("shared DesktopAuthProvider → list re-fetch", () => {
  beforeEach(() => {
    mockAuthFetch({ me: { loggedIn: false } });
  });

  it("LoginControl.login 后 identity 变化且 listAgentSources 再调", async () => {
    mockAuthFetch({ me: { loggedIn: false }, loginOk: true });
    const listAgentSources = vi.fn(async () => ({ sources: [] }));

    render(
      <DesktopAuthProvider>
        <AuthListHarness listAgentSources={listAgentSources} />
      </DesktopAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("login-open")).toBeTruthy();
    });

    const callsBefore = listAgentSources.mock.calls.length;
    expect(callsBefore).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("auth-identity").textContent).toBe("logged-out");

    fireEvent.click(screen.getByTestId("login-open"));
    fireEvent.change(screen.getByTestId("login-credential"), {
      target: { value: "desktop.cred.sig" },
    });
    fireEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("true");
      expect(screen.getByTestId("auth-identity").textContent).toBe(
        "logged-in:user-1",
      );
    });

    await waitFor(() => {
      expect(listAgentSources.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });

  it("logout 后 identity 回到 logged-out 并再次 list", async () => {
    // 先以已登录态启动
    mockAuthFetch({
      me: {
        loggedIn: true,
        userId: "user-1",
        companyId: "co-1",
        exp: 9_999_999_999,
        status: "valid",
      },
      loginOk: true,
    });
    const listAgentSources = vi.fn(async () => ({ sources: [] }));

    render(
      <DesktopAuthProvider>
        <AuthListHarness listAgentSources={listAgentSources} />
      </DesktopAuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("true");
    });
    const callsWhileIn = listAgentSources.mock.calls.length;

    fireEvent.click(screen.getByTestId("logout"));

    await waitFor(() => {
      expect(screen.getByTestId("logged-in").textContent).toBe("false");
      expect(screen.getByTestId("auth-identity").textContent).toBe("logged-out");
    });

    await waitFor(() => {
      expect(listAgentSources.mock.calls.length).toBeGreaterThan(callsWhileIn);
    });
  });

  it("两个 useDesktopAuth 消费者见同一 loggedIn(共享 Provider)", async () => {
    mockAuthFetch({ me: { loggedIn: false }, loginOk: true });

    function Twin(): React.JSX.Element {
      const a = useDesktopAuth();
      const b = useDesktopAuth();
      return (
        <div>
          <LoginControl />
          <span data-testid="a">{String(a.loggedIn)}</span>
          <span data-testid="b">{String(b.loggedIn)}</span>
        </div>
      );
    }

    render(
      <DesktopAuthProvider>
        <Twin />
      </DesktopAuthProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("login-open")).toBeTruthy());
    fireEvent.click(screen.getByTestId("login-open"));
    fireEvent.change(screen.getByTestId("login-credential"), {
      target: { value: "c" },
    });
    fireEvent.click(screen.getByTestId("login-submit"));

    await waitFor(() => {
      expect(screen.getByTestId("a").textContent).toBe("true");
      expect(screen.getByTestId("b").textContent).toBe("true");
    });
  });
});

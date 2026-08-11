/**
 * 账号密码登录表单 + 登录控件(spec: desktop-account-login,任务 7.5;
 * Req 2.2/2.3/2.4/2.5/3.1/3.2/3.3/3.4/3.5/5.1/5.2)。
 *
 * 最有价值的两条:
 *  - **取消不发任何请求**(用调用计数断言,而非"看起来没发")
 *  - **`canExchange:false` 时不渲染登录入口** —— 那是 Req 1.5「UI 不据宿主类型分支」
 *    的行为面:同一套组件面对云端多租户宿主时,靠状态而非靠 `if (isDesktop)` 收手。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import { LoginForm } from "../../components/auth/login-form.js";
import { LoginControl } from "../../components/auth/login-control.js";
import { IdentityStateProvider } from "../../components/auth/use-identity.js";

const TENANT = { userId: "u1", companyId: "c1", role: "member" };

describe("LoginForm — 输入与提交(Req 3.1/3.2)", () => {
  it("手机号密码输入项是掩码", () => {
    render(<LoginForm onSubmit={async () => ({ ok: true })} onCancel={() => {}} />);
    expect(screen.getByTestId("login-password").getAttribute("type")).toBe("password");
    expect(screen.getByTestId("login-phone").getAttribute("type")).toBe("tel");
  });

  it.each([
    ["两者皆空", "", ""],
    ["只填手机号", "13800138000", ""],
    ["只填密码", "", "pw"],
    ["手机号只有空白", "   ", "pw"],
  ])("%s → 提交按钮禁用,且点击不触发 onSubmit", async (_n, phone, password) => {
    let calls = 0;
    render(
      <LoginForm
        onSubmit={async () => {
          calls += 1;
          return { ok: true };
        }}
        onCancel={() => {}}
      />,
    );
    if (phone.length > 0) {
      fireEvent.change(screen.getByTestId("login-phone"), { target: { value: phone } });
    }
    if (password.length > 0) {
      fireEvent.change(screen.getByTestId("login-password"), { target: { value: password } });
    }
    const btn = screen.getByTestId("login-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await act(async () => {
      btn.click();
    });
    expect(calls).toBe(0);
  });

  it("两项齐全 → 可提交,手机号被 trim 而 password 原样传出", async () => {
    const seen: Array<[string, string]> = [];
    render(
      <LoginForm
        onSubmit={async (p, password) => {
          seen.push([p, password]);
          return { ok: true };
        }}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("login-phone"), { target: { value: "  13800138000  " } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: " pw " } });
    await act(async () => {
      screen.getByTestId("login-submit").click();
    });
    // 密码前后空格可能是密码的一部分 —— 擅自 trim 会让合法密码登不上。
    expect(seen).toEqual([["13800138000", " pw "]]);
  });

  it("提交中禁止重复提交", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    render(
      <LoginForm
        onSubmit={async () => {
          calls += 1;
          await new Promise<void>((r) => {
            release = r;
          });
          return { ok: true };
        }}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("login-phone"), { target: { value: "13800138000" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "pw" } });
    await act(async () => {
      screen.getByTestId("login-submit").click();
    });
    const btn = screen.getByTestId("login-submit") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toContain("登录中");
    await act(async () => {
      btn.click();
      release?.();
    });
    expect(calls).toBe(1);
  });
});

describe("LoginForm — 取消与失败文案(Req 2.3/2.4/3.3)", () => {
  it("密码登录沿用手机号,移除底部切换链接", async () => {
    const onSubmit = vi.fn(async () => ({ ok: true as const }));
    render(<LoginForm onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.change(screen.getByTestId("login-phone"), {
      target: { value: "13800138000" },
    });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "pw" } });
    expect(screen.queryByTestId("login-switch-sms")).toBeNull();
    expect(screen.queryByTestId("login-switch-password")).toBeNull();
    await act(async () => {
      screen.getByTestId("login-submit").click();
    });
    expect(onSubmit).toHaveBeenCalledWith("13800138000", "pw");
  });

  it("微信扫码直接内嵌二维码,不主动弹新窗口", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const start = vi.fn(async () => ({
      ok: true as const,
      state: "wx-state",
      appid: "wx-app",
      redirectUri: "https://cloud.test/api/desktop/wechat/callback",
      qrConnectUrl: "https://open.weixin.qq.com/connect/qrconnect?state=wx-state",
    }));
    const view = render(
      <LoginForm
        methods={["wechat"]}
        onSubmit={async () => ({ ok: true })}
        onWechatStart={start}
        onWechatPoll={async () => ({ ok: true as const, status: "pending" as const })}
        onWechatExchange={async () => ({ ok: true })}
        onCancel={() => {}}
      />,
    );
    const qr = await screen.findByTestId("login-wechat-qr");
    expect(qr.querySelector("iframe")).toHaveAttribute(
      "src",
      "https://open.weixin.qq.com/connect/qrconnect?state=wx-state",
    );
    expect(open).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /开始扫码|重新扫码/ })).toBeNull();
    expect(screen.queryByTestId("login-cancel")).toBeNull();
    expect(start).toHaveBeenCalledOnce();
    view.unmount();
    open.mockRestore();
  });

  it("★ 取消 → 清空两字段,且**不发任何请求**", async () => {
    let submits = 0;
    let cancelled = 0;
    render(
      <LoginForm
        onSubmit={async () => {
          submits += 1;
          return { ok: true };
        }}
        onCancel={() => {
          cancelled += 1;
        }}
      />,
    );
    fireEvent.change(screen.getByTestId("login-phone"), { target: { value: "13800138000" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "pw" } });
    await act(async () => {
      screen.getByTestId("login-cancel").click();
    });
    expect(submits).toBe(0);
    expect(cancelled).toBe(1);
    expect((screen.getByTestId("login-phone") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("login-password") as HTMLInputElement).value).toBe("");
  });

  it.each([
    ["invalid-credentials", "账号或密码错误"],
    ["cloud-unreachable", "无法连接云端,请重试"],
    ["capabilities-failed", "登录未完成:云端授权加载失败,请重试"],
    ["unsupported", "当前环境不支持账号密码登录"],
  ] as const)("%s → 文案「%s」", async (reason, text) => {
    render(
      <LoginForm onSubmit={async () => ({ ok: false, reason })} onCancel={() => {}} />,
    );
    fireEvent.change(screen.getByTestId("login-phone"), { target: { value: "13800138000" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "pw" } });
    await act(async () => {
      screen.getByTestId("login-submit").click();
    });
    await waitFor(() => expect(screen.getByTestId("login-error").textContent).toBe(text));
  });

  it("失败后保留手机号、只清密码(用户十有八九是打错了密码)", async () => {
    render(
      <LoginForm
        onSubmit={async () => ({ ok: false, reason: "invalid-credentials" as const })}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("login-phone"), { target: { value: "13800138000" } });
    fireEvent.change(screen.getByTestId("login-password"), { target: { value: "wrong" } });
    await act(async () => {
      screen.getByTestId("login-submit").click();
    });
    await waitFor(() =>
      expect((screen.getByTestId("login-password") as HTMLInputElement).value).toBe(""),
    );
    expect((screen.getByTestId("login-phone") as HTMLInputElement).value).toBe("13800138000");
  });
});

describe("LoginControl — 据身份状态分支渲染(Req 1.5/2.5/3.4/5.1/5.2)", () => {
  function mount(body: unknown, status = 200): void {
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
        <LoginControl />
      </IdentityStateProvider>,
    );
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GET 404(云端未配置)→ 不渲染任何入口(Req 2.5)", async () => {
    mount(undefined, 404);
    await waitFor(() => expect(screen.queryByTestId("login-open")).toBeNull());
    expect(screen.queryByTestId("login-form")).toBeNull();
    expect(screen.queryByTestId("login-status")).toBeNull();
  });

  it("★ anonymous 且 canExchange=false → 不渲染登录入口(云端多租户形态,Req 1.4/6.2)", async () => {
    mount({ state: "anonymous", canExchange: false });
    await waitFor(() => expect(screen.queryByTestId("login-open")).toBeNull());
  });

  it("anonymous 且 canExchange=true → 「登录」按钮 → 点开是账号密码表单(不是粘贴框)", async () => {
    mount({ state: "anonymous", canExchange: true });
    await waitFor(() => expect(screen.getByTestId("login-open")).toBeTruthy());
    await act(async () => {
      screen.getByTestId("login-open").click();
    });
    // Req 3.4:主路径不再是粘贴凭据串 —— 表单里应有 phone/password 两项。
    expect(screen.getByTestId("login-phone")).toBeTruthy();
    expect(screen.getByTestId("login-password")).toBeTruthy();
  });

  it("★ 有 displayName(云端 profiles.name)→ 展示名字而非 UUID", async () => {
    mount({
      state: "authenticated",
      tenant: { ...TENANT, displayName: "张三" },
      canExchange: true,
    });
    await waitFor(() => expect(screen.getByTestId("login-user").textContent).toBe("张三"));
    // UUID 仍可经 title 查看 —— 名字可重名,排查问题时要的是权威标识。
    expect(screen.getByTestId("login-user").getAttribute("title")).toBe(TENANT.userId);
  });

  it("长展示名单行省略，完整名称保留于可访问名称且不挤压登出按钮", async () => {
    const name = "这是一个很长很长的宿主用户展示名称";
    mount({
      state: "authenticated",
      tenant: { ...TENANT, displayName: name },
      canExchange: true,
    });
    const user = await screen.findByTestId("login-user");
    expect(user).toHaveClass("truncate", "whitespace-nowrap", "min-w-0");
    expect(user).toHaveAttribute("aria-label", name);
    expect(screen.getByTestId("logout")).toHaveClass("shrink-0");
  });

  it("无 displayName → 退回 userId(云端未提供时行为与之前一致)", async () => {
    mount({ state: "authenticated", tenant: TENANT, canExchange: true });
    await waitFor(() =>
      expect(screen.getByTestId("login-user").textContent).toBe(TENANT.userId),
    );
  });

  it("authenticated → 展示 tenant.userId 与 companyId(Req 5.1/5.2)", async () => {
    mount({ state: "authenticated", tenant: TENANT, canExchange: true });
    await waitFor(() => expect(screen.getByTestId("login-user").textContent).toBe("u1"));
    expect(screen.getByTestId("login-company").textContent).toBe("@c1");
    expect(screen.getByTestId("logout")).toBeTruthy();
  });

  it("companyId 缺失 → 不渲染公司标签,但用户名仍在(Req 5.3)", async () => {
    mount({ state: "authenticated", tenant: { userId: "u9" }, canExchange: true });
    await waitFor(() => expect(screen.getByTestId("login-user").textContent).toBe("u9"));
    expect(screen.queryByTestId("login-company")).toBeNull();
  });
});

beforeEach(() => {
  vi.unstubAllGlobals();
});

"use client";

/**
 * 多方法登录：密码 / 短信 / 微信。
 * 设计：黑白灰阶、控件 7px、外层 10px、可见 label、autofill、历史账户。
 */
import * as React from "react";
import type { IdentityExchangeReason } from "./use-identity.js";
import {
  listLoginAccounts,
  maskLoginAccount,
  removeLoginAccount,
  upsertLoginAccount,
  type LoginAccountEntry,
} from "./account-history.js";

const MESSAGE: Readonly<Record<IdentityExchangeReason, string>> = {
  "invalid-credentials": "账号或密码错误",
  "no-membership": "该账号未加入任何组织,请更换账号或联系管理员开通",
  "invalid-request": "请填写完整登录信息",
  "cloud-unreachable": "无法连接云端,请重试",
  "capabilities-failed": "登录未完成:云端授权加载失败,请重试",
  unsupported: "当前环境不支持账号密码登录",
};

function wechatErrorMessage(error: string | undefined): string {
  if (error === "no-membership") return MESSAGE["no-membership"];
  if (error === "invalid-state") return "登录状态已失效，请重新扫码";
  if (error === "wechat-token") return "微信授权交换失败，请重新扫码";
  if (error === "wechat-no-user") return "微信账号未完成云端注册，请联系管理员";
  return "微信登录失败，请重试";
}

export type LoginMethod = "password" | "sms" | "wechat";

export interface LoginFormProps {
  readonly onSubmit: (
    identifier: string,
    password: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  readonly onSmsSubmit?: (
    phone: string,
    code: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  readonly onSendOtp?: (
    phone: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason | "rate-limited" }>;
  readonly onWechatStart?: () => Promise<
    | {
        ok: true;
        state: string;
        appid: string;
        redirectUri: string;
        qrConnectUrl: string;
      }
    | { ok: false; reason?: IdentityExchangeReason }
  >;
  readonly onWechatPoll?: (
    state: string,
  ) => Promise<
    | { ok: true; status: "pending" | "claimed" | "unknown" | "error"; error?: string }
    | { ok: true; status: "ready"; credential: string }
    | { ok: false; reason?: IdentityExchangeReason }
  >;
  readonly onWechatExchange?: (
    state: string,
    credential: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  readonly methods?: ReadonlyArray<LoginMethod>;
  readonly onCancel: () => void;
  readonly testIdPrefix?: string;
  readonly layout?: "inline" | "page";
}

const METHOD_LABEL: Record<LoginMethod, string> = {
  password: "密码",
  sms: "短信",
  wechat: "微信",
};

function fieldClass(page: boolean): string {
  return page
    ? "w-full rounded-[7px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-2.5 text-sm text-[hsl(var(--foreground))] outline-none transition-colors placeholder:text-[hsl(var(--muted-foreground))] focus:border-[hsl(var(--ring))] focus:ring-2 focus:ring-[hsl(var(--ring))]"
    : "w-full min-w-0 rounded-[7px] border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-2 py-1.5 text-xs text-[hsl(var(--foreground))] outline-none focus:ring-2 focus:ring-[hsl(var(--ring))]";
}

function primaryBtnClass(page: boolean): string {
  return page
    ? "inline-flex h-10 w-full items-center justify-center rounded-[7px] bg-[hsl(var(--primary))] px-3 text-sm font-medium text-[hsl(var(--primary-foreground))] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
    : "inline-flex items-center justify-center rounded-[7px] border border-[hsl(var(--border))] bg-[hsl(var(--primary))] px-2 py-1 text-xs text-[hsl(var(--primary-foreground))] disabled:opacity-40";
}

function ghostBtnClass(page: boolean): string {
  return page
    ? "inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-[7px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] px-3 text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--surface-subtle))] disabled:pointer-events-none disabled:opacity-40"
    : "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-[7px] border border-[hsl(var(--border))] px-2 py-1 text-xs hover:bg-[hsl(var(--surface-subtle))] disabled:opacity-40";
}

export function LoginForm(props: LoginFormProps): React.JSX.Element {
  const prefix = props.testIdPrefix ?? "login";
  const page = props.layout === "page";
  const methods = React.useMemo(
    () => props.methods ?? (["password", "sms", "wechat"] as LoginMethod[]),
    [props.methods],
  );

  const [method, setMethod] = React.useState<LoginMethod>(() =>
    methods.includes("password") ? "password" : (methods[0] ?? "password"),
  );
  const [password, setPassword] = React.useState("");
  const [identifier, setIdentifier] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [countdown, setCountdown] = React.useState(0);
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  const [otpSent, setOtpSent] = React.useState(false);
  const [history, setHistory] = React.useState<LoginAccountEntry[]>([]);
  const [wxUrl, setWxUrl] = React.useState<string | undefined>(undefined);
  const [wxState, setWxState] = React.useState<string | undefined>(undefined);
  const [wxStatus, setWxStatus] = React.useState<
    "idle" | "loading" | "show" | "success" | "error" | "expired"
  >("idle");
  const pollRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = React.useRef(false);
  const wechatAutoStartedRef = React.useRef(false);

  React.useEffect(() => {
    if (!methods.includes(method)) {
      setMethod(methods.includes("password") ? "password" : (methods[0] ?? "password"));
    }
  }, [methods, method]);

  React.useEffect(() => {
    setHistory(listLoginAccounts());
  }, []);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const stopPoll = React.useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  React.useEffect(() => () => stopPoll(), [stopPoll]);

  const resetWechat = React.useCallback((): void => {
    stopPoll();
    setWxState(undefined);
    setWxUrl(undefined);
    setWxStatus("idle");
  }, [stopPoll]);

  const startWechat = React.useCallback(async (): Promise<void> => {
    if (!props.onWechatStart || !props.onWechatPoll || !props.onWechatExchange) {
      setError(MESSAGE.unsupported);
      return;
    }
    stopPoll();
    setBusy(true);
    setError(undefined);
    setWxStatus("loading");
    const started = await props.onWechatStart();
    setBusy(false);
    if (!started.ok) {
      setWxStatus("error");
      setError(
        started.reason === "cloud-unreachable"
          ? "微信登录未配置或云端不可达"
          : MESSAGE[started.reason ?? "cloud-unreachable"],
      );
      return;
    }
    setWxState(started.state);
    setWxUrl(started.qrConnectUrl);
    setWxStatus("show");
    pollRef.current = setInterval(() => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      void (async () => {
        try {
          const polled = await props.onWechatPoll!(started.state);
          if (!polled.ok) {
            setWxStatus("error");
            setError(MESSAGE[polled.reason ?? "cloud-unreachable"]);
            stopPoll();
            return;
          }
          if (polled.status === "pending") return;
          if (polled.status === "error") {
            setWxStatus("error");
            setError(wechatErrorMessage(polled.error));
            stopPoll();
            return;
          }
          if (polled.status === "ready") {
            stopPoll();
            setBusy(true);
            const ex = await props.onWechatExchange!(started.state, polled.credential);
            setBusy(false);
            if (!ex.ok) {
              setWxStatus("error");
              setError(MESSAGE[ex.reason ?? "cloud-unreachable"]);
              return;
            }
            setWxStatus("success");
          }
          if (polled.status === "claimed" || polled.status === "unknown") {
            setWxStatus("expired");
            stopPoll();
          }
        } finally {
          pollInFlightRef.current = false;
        }
      })();
    }, 2000);
  }, [props.onWechatExchange, props.onWechatPoll, props.onWechatStart, stopPoll]);

  React.useEffect(() => {
    if (method === "wechat") {
      if (wechatAutoStartedRef.current) return;
      wechatAutoStartedRef.current = true;
      void startWechat();
    } else {
      wechatAutoStartedRef.current = false;
      resetWechat();
    }
  }, [method, resetWechat, startWechat]);

  const selectMethod = (next: LoginMethod): void => {
    setError(undefined);
    if (next !== "wechat") resetWechat();
    setMethod(next);
  };

  const applyHistory = (entry: LoginAccountEntry): void => {
    setError(undefined);
    if (method === "password") {
      setIdentifier(entry.value);
    } else if (entry.kind === "phone") {
      setPhone(entry.value);
    }
  };

  const submitPassword = async (): Promise<void> => {
    const account = identifier.trim();
    if (account.length === 0 || password.length === 0 || busy) {
      setError(MESSAGE["invalid-request"]);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await props.onSubmit(account, password);
    setBusy(false);
    if (result.ok) {
      upsertLoginAccount(account.includes("@") ? "email" : "phone", account);
      setHistory(listLoginAccounts());
      setIdentifier("");
      setPassword("");
      return;
    }
    setError(MESSAGE[result.reason ?? "cloud-unreachable"]);
    setPassword("");
  };

  const sendOtp = async (): Promise<void> => {
    if (!props.onSendOtp || phone.trim().length === 0 || countdown > 0 || busy) return;
    setBusy(true);
    setError(undefined);
    const result = await props.onSendOtp(phone.trim());
    setBusy(false);
    if (!result.ok) {
      setError(
        result.reason === "rate-limited"
          ? "发送过于频繁，请稍后再试"
          : result.reason === "cloud-unreachable"
            ? "无法发送验证码（检查云端/短信通道是否已配置）"
            : MESSAGE[result.reason === "invalid-request" ? "invalid-request" : "cloud-unreachable"],
      );
      return;
    }
    setOtpSent(true);
    setCountdown(60);
  };

  const submitSms = async (): Promise<void> => {
    if (!props.onSmsSubmit || phone.trim().length === 0 || code.trim().length === 0 || busy) {
      setError(MESSAGE["invalid-request"]);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await props.onSmsSubmit(phone.trim(), code.trim());
    setBusy(false);
    if (result.ok) {
      upsertLoginAccount("phone", phone.trim());
      setHistory(listLoginAccounts());
      setCode("");
      return;
    }
    setError(MESSAGE[result.reason ?? "cloud-unreachable"]);
    setCode("");
  };

  const inputCls = fieldClass(page);
  const primaryCls = primaryBtnClass(page);
  const ghostCls = ghostBtnClass(page);
  const labelCls =
    "mb-1.5 block text-xs font-medium text-[hsl(var(--muted-foreground))]";

  const relevantHistory = history.filter((h) =>
    method === "password" ? true : method === "sms" ? h.kind === "phone" : false,
  );

  return (
    <div
      className={page ? "flex w-full flex-col gap-4" : "flex w-full min-w-[16rem] flex-col gap-2.5"}
      data-testid={`${prefix}-form`}
    >
      {methods.length > 1 ? (
        <div
          className="grid gap-1 rounded-[10px] bg-[hsl(var(--surface-subtle))] p-1"
          style={{ gridTemplateColumns: `repeat(${methods.length}, minmax(0, 1fr))` }}
          role="tablist"
          aria-label="登录方式"
        >
          {methods.map((m) => {
            const active = method === m;
            return (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`${prefix}-tab-${m}`}
                className={
                  active
                    ? "rounded-[7px] bg-[hsl(var(--background))] px-2 py-2 text-sm font-medium text-[hsl(var(--foreground))] shadow-sm"
                    : "rounded-[7px] px-2 py-2 text-sm text-[hsl(var(--muted-foreground))] transition-colors hover:text-[hsl(var(--foreground))]"
                }
                onClick={() => selectMethod(m)}
              >
                {METHOD_LABEL[m]}
              </button>
            );
          })}
        </div>
      ) : null}

      {relevantHistory.length > 0 ? (
        <div className="flex flex-col gap-1.5" data-testid={`${prefix}-history`}>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">最近使用</span>
          <div className="flex flex-wrap gap-1.5">
            {relevantHistory.map((h) => (
              <span
                key={`${h.kind}:${h.value}`}
                className="inline-flex max-w-full items-center gap-1 rounded-full border border-[hsl(var(--border))] bg-[hsl(var(--surface))] py-0.5 pl-2.5 pr-1 text-xs text-[hsl(var(--foreground))]"
              >
                <button
                  type="button"
                  className="min-w-0 truncate hover:underline"
                  onClick={() => applyHistory(h)}
                >
                  {maskLoginAccount(h)}
                </button>
                <button
                  type="button"
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--surface-subtle))] hover:text-[hsl(var(--foreground))]"
                  aria-label="移除历史账户"
                  onClick={() => {
                    removeLoginAccount(h.kind, h.value);
                    setHistory(listLoginAccounts());
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {method === "password" ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls} htmlFor={`${prefix}-identifier`}>
              邮箱或手机号
            </label>
            <input
              id={`${prefix}-identifier`}
              name="username"
              type="text"
              className={inputCls}
              placeholder="输入邮箱或手机号"
              value={identifier}
              autoComplete="username"
              data-login-field="identifier"
              inputMode="email"
              data-testid={`${prefix}-phone`}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitPassword();
                if (e.key === "Escape") props.onCancel();
              }}
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${prefix}-password`}>
              密码
            </label>
            <input
              id={`${prefix}-password`}
              name="password"
              type="password"
              className={inputCls}
              placeholder="输入密码"
              value={password}
              autoComplete="current-password"
              data-testid={`${prefix}-password`}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void submitPassword();
                if (e.key === "Escape") props.onCancel();
              }}
            />
          </div>
          <button
            type="button"
            className={primaryCls}
            data-testid={`${prefix}-submit`}
            disabled={busy || identifier.trim().length === 0 || password.length === 0}
            onClick={() => void submitPassword()}
          >
            {busy ? "登录中…" : "登录"}
          </button>
        </div>
      ) : null}

      {method === "sms" ? (
        <div className="flex flex-col gap-3">
          <div>
            <label className={labelCls} htmlFor={`${prefix}-phone`}>
              手机号
            </label>
            <input
              id={`${prefix}-phone`}
              name="tel"
              type="tel"
              className={inputCls}
              placeholder="11 位手机号"
              value={phone}
              autoComplete="tel"
              inputMode="tel"
              data-testid={`${prefix}-phone`}
              onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, ""))}
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls} htmlFor={`${prefix}-otp`}>
              验证码
            </label>
            <div className="flex gap-2">
              <input
                id={`${prefix}-otp`}
                name="one-time-code"
                type="text"
                className={`${inputCls} flex-1`}
                placeholder={otpSent ? "6 位验证码" : "先获取验证码"}
                value={code}
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
                data-testid={`${prefix}-otp`}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitSms();
                }}
              />
              <button
                type="button"
                className={ghostCls}
                disabled={busy || countdown > 0 || phone.trim().length < 11}
                data-testid={`${prefix}-send-otp`}
                onClick={() => void sendOtp()}
              >
                {countdown > 0 ? `${countdown}s` : otpSent ? "重新获取" : "获取验证码"}
              </button>
            </div>
          </div>
          <button
            type="button"
            className={primaryCls}
            data-testid={`${prefix}-sms-submit`}
            disabled={busy || phone.trim().length === 0 || code.trim().length < 4}
            onClick={() => void submitSms()}
          >
            {busy ? "登录中…" : "登录"}
          </button>
        </div>
      ) : null}

      {method === "wechat" ? (
        <div
          className="flex flex-col items-stretch gap-3 rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] p-4"
          data-testid={`${prefix}-wechat`}
        >
          <div className="text-center">
            <p className="text-sm font-medium text-[hsl(var(--foreground))]">微信扫码登录</p>
            {wxStatus !== "show" ? (
              <p className="mt-1 text-xs leading-relaxed text-[hsl(var(--muted-foreground))]">
                {wxStatus === "idle" && "正在准备二维码…"}
                {wxStatus === "loading" && "正在准备登录会话…"}
                {wxStatus === "success" && "登录成功"}
                {wxStatus === "error" && "登录失败，可重试"}
                {wxStatus === "expired" && "会话已失效，请重新扫码"}
              </p>
            ) : null}
          </div>
          {wxUrl ? (
            <div
              className="overflow-hidden rounded-[7px] border border-[hsl(var(--border))] bg-white"
              data-testid={`${prefix}-wechat-qr`}
            >
              <iframe
                src={wxUrl}
                title="微信扫码登录"
                className="block h-[360px] w-full overflow-hidden border-0 bg-white"
                loading="eager"
                referrerPolicy="no-referrer"
                scrolling="no"
              />
            </div>
          ) : null}
          {wxState ? (
            <span className="sr-only" data-testid={`${prefix}-wechat-state`}>
              {wxState}
            </span>
          ) : null}
        </div>
      ) : null}

      {!page && method !== "wechat" ? (
        <button
          type="button"
          className={ghostCls}
          data-testid={`${prefix}-cancel`}
          onClick={() => {
            setPassword("");
            setIdentifier("");
            setPhone("");
            setCode("");
            setError(undefined);
            setOtpSent(false);
            props.onCancel();
          }}
        >
          取消
        </button>
      ) : null}

      {error !== undefined ? (
        <div
          role="alert"
          className={
            page
              ? "rounded-[7px] border border-[hsl(var(--border))] bg-[hsl(var(--surface-subtle))] px-3 py-2 text-sm text-[hsl(var(--foreground))]"
              : "text-xs text-[hsl(var(--muted-foreground))]"
          }
          data-testid={`${prefix}-error`}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

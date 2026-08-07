"use client";

/**
 * 已登录用户绑手机最小入口。
 */
import * as React from "react";

const INPUT =
  "w-full rounded-[7px] border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const BTN =
  "inline-flex items-center justify-center rounded-[7px] border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-50";

export function BindPhoneForm(props: {
  readonly onSend: (phone: string) => Promise<{ ok: boolean; error?: string }>;
  readonly onVerify: (
    phone: string,
    code: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  readonly testIdPrefix?: string;
}): React.JSX.Element {
  const prefix = props.testIdPrefix ?? "bind-phone";
  const [phone, setPhone] = React.useState("");
  const [code, setCode] = React.useState("");
  const [countdown, setCountdown] = React.useState(0);
  const [error, setError] = React.useState<string | undefined>();
  const [okMsg, setOkMsg] = React.useState<string | undefined>();
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => (c <= 1 ? 0 : c - 1)), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  return (
    <div className="flex flex-col gap-2" data-testid={`${prefix}-form`}>
      <p className="text-sm text-muted-foreground">绑定手机号后可用短信登录</p>
      <label className="sr-only" htmlFor={`${prefix}-phone`}>
        手机号
      </label>
      <input
        id={`${prefix}-phone`}
        type="tel"
        className={INPUT}
        placeholder="手机号"
        autoComplete="tel"
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        data-testid={`${prefix}-phone`}
      />
      <div className="flex gap-2">
        <input
          type="text"
          className={`${INPUT} flex-1`}
          placeholder="验证码"
          autoComplete="one-time-code"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          data-testid={`${prefix}-otp`}
        />
        <button
          type="button"
          className={BTN}
          disabled={busy || countdown > 0 || !phone.trim()}
          onClick={() => {
            void (async () => {
              setBusy(true);
              setError(undefined);
              setOkMsg(undefined);
              const r = await props.onSend(phone.trim());
              setBusy(false);
              if (!r.ok) setError(r.error ?? "发送失败");
              else setCountdown(60);
            })();
          }}
        >
          {countdown > 0 ? `${countdown}s` : "获取验证码"}
        </button>
      </div>
      <button
        type="button"
        className={`${BTN} bg-primary text-primary-foreground`}
        disabled={busy || !phone.trim() || !code.trim()}
        data-testid={`${prefix}-submit`}
        onClick={() => {
          void (async () => {
            setBusy(true);
            setError(undefined);
            const r = await props.onVerify(phone.trim(), code.trim());
            setBusy(false);
            if (!r.ok) setError(r.error ?? "验证失败");
            else {
              setOkMsg("绑定成功");
              setCode("");
            }
          })();
        }}
      >
        绑定
      </button>
      {error && (
        <span role="alert" className="text-sm text-destructive">
          {error}
        </span>
      )}
      {okMsg && <span className="text-sm text-muted-foreground">{okMsg}</span>}
    </div>
  );
}

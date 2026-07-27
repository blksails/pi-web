"use client";

/**
 * 账号密码登录表单(spec: desktop-account-login,任务 7.2;Req 2.2/2.3/2.4/3.1/3.2/3.3)。
 *
 * 替换 `desktop-cloud-login` 交付的「粘贴凭据串」输入框 —— 那个形态的问题不是难用,
 * 是**用户手上根本没有凭据串**,也没有任何途径获得它(云端实测只提供账号密码端点,
 * 从无 device 授权流)。
 *
 * 安全:密码只存在于本组件 state 与请求体中,提交后立即清空;不进 URL、不进 localStorage、
 * 不回显。凭据串永不进入渲染层(Req 8.2)。
 */
import * as React from "react";
import type { IdentityExchangeReason } from "./use-identity.js";

const BTN =
  "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50";
const INPUT = "rounded-md border border-border px-2 py-1 text-xs";

/** 失败原因 → 用户可读文案。分类的全部意义就在这里:告诉用户该改什么再重试。 */
const MESSAGE: Readonly<Record<IdentityExchangeReason, string>> = {
  "invalid-credentials": "账号或密码错误",
  "invalid-request": "请填写邮箱与密码",
  "cloud-unreachable": "无法连接云端,请重试",
  "capabilities-failed": "登录未完成:云端授权加载失败,请重试",
  unsupported: "当前环境不支持账号密码登录",
};

export interface LoginFormProps {
  readonly onSubmit: (
    email: string,
    password: string,
  ) => Promise<{ ok: boolean; reason?: IdentityExchangeReason }>;
  readonly onCancel: () => void;
  readonly testIdPrefix?: string;
}

export function LoginForm(props: LoginFormProps): React.JSX.Element {
  const prefix = props.testIdPrefix ?? "login";
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [error, setError] = React.useState<string | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);

  // 密码不 trim:前后空格可能是密码的一部分,擅自裁剪会让合法密码登不上。
  const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

  const submit = async (): Promise<void> => {
    if (!canSubmit) {
      setError(MESSAGE["invalid-request"]);
      return;
    }
    setBusy(true);
    setError(undefined);
    const result = await props.onSubmit(email.trim(), password);
    setBusy(false);
    if (result.ok) {
      // 成功即刻清空 —— 密码不在内存里多留一帧。
      setEmail("");
      setPassword("");
      return;
    }
    setError(MESSAGE[result.reason ?? "cloud-unreachable"]);
    // 失败时保留邮箱、只清密码:用户十有八九是打错了密码,不该逼他重打邮箱。
    setPassword("");
  };

  const cancel = (): void => {
    // 取消 → 清空两个字段,且**不发任何请求**(Req 3.3)。
    setEmail("");
    setPassword("");
    setError(undefined);
    props.onCancel();
  };

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter") void submit();
    if (e.key === "Escape") cancel();
  };

  return (
    <div className="flex items-center gap-1" data-testid={`${prefix}-form`}>
      <input
        type="email"
        className={INPUT}
        placeholder="邮箱"
        value={email}
        autoComplete="username"
        data-testid={`${prefix}-email`}
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
      />
      <input
        type="password"
        className={INPUT}
        placeholder="密码"
        value={password}
        autoComplete="current-password"
        data-testid={`${prefix}-password`}
        onChange={(e) => setPassword(e.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className={BTN}
        data-testid={`${prefix}-submit`}
        disabled={!canSubmit}
        onClick={() => void submit()}
      >
        {busy ? "登录中…" : "登录"}
      </button>
      <button type="button" className={BTN} data-testid={`${prefix}-cancel`} onClick={cancel}>
        取消
      </button>
      {error !== undefined && (
        <span className="text-xs text-destructive" data-testid={`${prefix}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

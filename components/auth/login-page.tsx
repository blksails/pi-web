"use client";

/**
 * 独立登录页 + 登录门禁。
 * 安静工作台登录：居中卡片、10px 外圆角、无营销分栏。
 */
import * as React from "react";
import { useIdentity } from "./use-identity.js";
import { LoginForm } from "./login-form.js";

/** 独立登录页(整屏居中卡片)。 */
export function LoginPage(): React.JSX.Element {
  const identity = useIdentity();
  return (
    <div
      className="flex h-full min-h-screen w-full items-center justify-center bg-[hsl(var(--background))] p-6"
      data-testid="login-page"
    >
      <div className="w-full max-w-[22rem] rounded-[10px] border border-[hsl(var(--border))] bg-[hsl(var(--surface))] p-6 shadow-sm sm:max-w-md sm:p-7">
        <div className="mb-6 flex flex-col gap-1.5">
          <h1 className="text-xl font-medium tracking-tight text-[hsl(var(--foreground))]">
            登录 pi-web
          </h1>
          <p className="text-sm leading-relaxed text-[hsl(var(--muted-foreground))]">
            使用云端账号登录，启用线上 agent 源与云端模型。
          </p>
        </div>
        <LoginForm
          layout="page"
          testIdPrefix="login"
          methods={identity.methods}
          onSubmit={(identifier, password) => identity.exchange(identifier, password)}
          onSmsSubmit={(phone, code) => identity.exchangeSms(phone, code)}
          onSendOtp={(phone) => identity.sendOtp(phone)}
          onWechatStart={() => identity.startWechat()}
          onWechatPoll={(state) => identity.pollWechat(state)}
          onWechatExchange={(state, credential) =>
            identity.exchangeWechat(state, credential)
          }
          onCancel={() => {
            /* 登录页无返回 */
          }}
        />
      </div>
    </div>
  );
}

/**
 * 登录门禁:据身份态决定渲染登录页还是放行 `children`。
 */
export function IdentityGate(props: {
  readonly children: React.ReactNode;
}): React.JSX.Element | null {
  const { state } = useIdentity();

  if (state.kind === "loading") return null;
  if (state.kind === "disabled") return <>{props.children}</>;
  if (state.kind === "anonymous" && !state.canExchange) return <>{props.children}</>;
  if (state.kind === "anonymous") return <LoginPage />;
  return <>{props.children}</>;
}

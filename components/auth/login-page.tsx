"use client";

/**
 * 独立登录页 + 登录门禁(spec: desktop-account-login,Req 10)。
 *
 * ## ★ 门禁**不是**无条件的
 *
 * 「没登录不让进主页面」这条,只在**登录这件事在此宿主上确实存在**时才成立。
 * 判定完全来自身份端口返回的状态,不含任何宿主类型判断(Req 1.5):
 *
 * | 身份态 | 拦不拦 | 为什么 |
 * |---|---|---|
 * | `loading` | 拦(渲染空白) | 尚不知道该不该拦;闪一下登录页再跳走比空白更糟 |
 * | `disabled` | **不拦** | 云端未配置 —— 这里根本没有「登录」这回事。拦了等于把纯本地用法和浏览器用法整个废掉 |
 * | `anonymous` + `canExchange` | **拦** | 能登录且没登录 → 登录页 |
 * | `anonymous` + `!canExchange` | **不拦** | 云端多租户宿主:身份由它自身的登录路径处理,本层拦了只会挡在它前面 |
 * | `authenticated` | 不拦 | — |
 *
 * 中间两行是这个组件最容易被写错的地方。把 `disabled` 也拦上,应用在没配置云端时
 * 会变成一块永远登不进去的登录页 —— 而那正是绝大多数本地开发者的使用形态。
 */
import * as React from "react";
import { useIdentity } from "./use-identity.js";
import { LoginForm } from "./login-form.js";

/** 独立登录页(整屏居中卡片)。 */
export function LoginPage(): React.JSX.Element {
  const identity = useIdentity();
  return (
    <div
      className="flex h-full min-h-screen w-full items-center justify-center bg-background p-6"
      data-testid="login-page"
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-1">
          <h1 className="text-lg font-semibold text-foreground">登录 pi-web</h1>
          <p className="text-sm text-muted-foreground">
            使用你的云端账号登录,以启用线上 agent 源与云端模型。
          </p>
        </div>
        <LoginForm
          layout="page"
          testIdPrefix="login"
          onSubmit={(email, password) => identity.exchange(email, password)}
          onCancel={() => {
            /* 登录页没有可返回之处;Esc 不做任何事。 */
          }}
        />
      </div>
    </div>
  );
}

/**
 * 登录门禁:据身份态决定渲染登录页还是放行 `children`。
 *
 * 必须在 `IdentityStateProvider` 内使用。
 */
export function IdentityGate(props: {
  readonly children: React.ReactNode;
}): React.JSX.Element | null {
  const { state } = useIdentity();

  // 还不知道该不该拦。渲染空白而非登录页 —— 先闪一下登录页再跳走,比短暂空白更糟。
  if (state.kind === "loading") return null;

  // 云端未配置 / 该宿主不支持凭据交换 → 本层不介入,直接放行(见文件顶部表格)。
  if (state.kind === "disabled") return <>{props.children}</>;
  if (state.kind === "anonymous" && !state.canExchange) return <>{props.children}</>;

  if (state.kind === "anonymous") return <LoginPage />;

  return <>{props.children}</>;
}

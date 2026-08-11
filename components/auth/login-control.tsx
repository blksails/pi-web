"use client";

/**
 * 登录控件(spec: desktop-account-login,任务 7.3;Req 3.4/3.5/5.1/5.2/5.3/7.1。
 * 上游 desktop-cloud-login 任务 5.2/5.3)。
 *
 * 单一头部控件,**只据身份端口返回的状态**分支渲染 —— 不查询、也无从查询自己跑在
 * 哪种宿主上(Req 1.5):
 *
 *  - `disabled`(能力面未挂载 / 云端未配置)→ 不渲染任何入口(Req 2.5)
 *  - `anonymous` 且 `canExchange` → 「登录」按钮 → 账号密码表单
 *  - `anonymous` 且 `!canExchange` → 不渲染表单(身份由该宿主自身路径处理,Req 6.2)
 *  - `authenticated` → 展示 tenant 身份 + 登出;需重登时同一表单收凭据(Req 3.5)
 *
 * 身份来源是 **`tenant` 授予**,不是凭据串解析出的 payload —— 后者是本地对一个不验签
 * 字符串的解读,前者是云端对「你是谁」的权威表态。
 */
import * as React from "react";
import { tenantDisplayName, useIdentity } from "./use-identity.js";
import { LoginForm } from "./login-form.js";

const BTN =
  "inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-accent";

export function LoginControl({
  className,
}: {
  readonly className?: string;
} = {}): React.JSX.Element | null {
  const identity = useIdentity();
  const [formOpen, setFormOpen] = React.useState(false);

  const { state } = identity;

  // 未启用 / 加载中 → 不渲染,避免闪烁。
  if (state.kind === "disabled" || state.kind === "loading") return null;

  const form = (prefix: string): React.JSX.Element => (
    <LoginForm
      testIdPrefix={prefix}
      methods={identity.methods}
      onSubmit={async (phone, password) => {
        const r = await identity.exchange(phone, password);
        if (r.ok) setFormOpen(false);
        return r;
      }}
      onSmsSubmit={async (phone, code) => {
        const r = await identity.exchangeSms(phone, code);
        if (r.ok) setFormOpen(false);
        return r;
      }}
      onSendOtp={(phone) => identity.sendOtp(phone)}
      onWechatStart={() => identity.startWechat()}
      onWechatPoll={(state) => identity.pollWechat(state)}
      onWechatExchange={async (state, credential) => {
        const r = await identity.exchangeWechat(state, credential);
        if (r.ok) setFormOpen(false);
        return r;
      }}
      onCancel={() => setFormOpen(false)}
    />
  );

  if (state.kind === "anonymous") {
    // 该宿主不支持凭据交换 —— 正常态,不是缺陷(Req 1.4/6.3)。不渲染登录入口。
    if (!state.canExchange) return null;
    if (!formOpen) {
      return (
        <button
          type="button"
          className={BTN}
          data-testid="login-open"
          onClick={() => setFormOpen(true)}
        >
          登录
        </button>
      );
    }
    return form("login");
  }

  // 已认证:身份 + 登出(+ 需重登时的内联表单)。
  const displayName = tenantDisplayName(state.tenant);
  return (
    <div
      className={`flex min-w-0 max-w-full items-center gap-1.5 ${className ?? ""}`}
      data-testid="login-status"
    >
      {/* 展示名优先,退回 userId(UUID)。云端未提供 profiles.name 时行为与之前一致。 */}
      <span
        className="min-w-0 flex-1 truncate whitespace-nowrap text-xs text-muted-foreground"
        data-testid="login-user"
        title={state.tenant.userId}
        aria-label={displayName}
      >
        {displayName}
      </span>
      {state.tenant.companyId.length > 0 && (
        <span className="max-w-24 shrink truncate whitespace-nowrap text-xs text-muted-foreground/70" data-testid="login-company">
          @{state.tenant.companyId}
        </span>
      )}
      {identity.needsReauth && (
        <>
          <span className="text-xs text-destructive" data-testid="login-needs-reauth">
            需重新登录
          </span>
          {state.canExchange && !formOpen && (
            <button
              type="button"
              className={BTN}
              data-testid="login-reauth"
              onClick={() => setFormOpen(true)}
            >
              重新登录
            </button>
          )}
        </>
      )}
      <button
        type="button"
        className={BTN}
        data-testid="logout"
        onClick={() => void identity.revoke()}
      >
        登出
      </button>
      {/* 重登/切号走**同一个**账号密码表单,不再要求粘贴凭据串(Req 3.5)。 */}
      {formOpen && state.canExchange && form("reauth")}
    </div>
  );
}

"use client";

/**
 * 侧栏底账户区(ChatGPT 式):外露 头像 + 全名 + 一个重要入口(设置);
 * 主题/语言/登出等收敛进向上弹层。
 */
import * as React from "react";
import { useI18n, useLocale } from "@blksails/pi-web-ui";
import { tenantDisplayName, useIdentity } from "./use-identity.js";
import { LoginForm } from "./login-form.js";
import { BindPhoneForm } from "./bind-phone-form.js";
import { useThemeToggle } from "@/src/theme-controls.js";

function initialsOf(name: string): string {
  const t = name.trim();
  if (t.length === 0) return "?";
  // 中文等:取首字;拉丁:最多两词首字母。
  if (/[\u4e00-\u9fff]/.test(t)) return t.slice(0, 1);
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (
      (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")
    ).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

function Avatar({
  label,
  className,
}: {
  readonly label: string;
  readonly className?: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={
        className ??
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--foreground))] text-[11px] font-semibold text-[hsl(var(--background))]"
      }
    >
      {initialsOf(label)}
    </span>
  );
}

const MENU_ITEM =
  "flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-sm text-[hsl(var(--foreground))] transition-colors hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]";

export function AccountBar({
  className,
}: {
  readonly className?: string;
} = {}): React.JSX.Element {
  const t = useI18n();
  const identity = useIdentity();
  const { locale, setLocale } = useLocale();
  const theme = useThemeToggle();
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [formOpen, setFormOpen] = React.useState(false);
  const [bindPhoneOpen, setBindPhoneOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent): void => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const { state } = identity;
  const goSettings = (): void => {
    try {
      sessionStorage.setItem(
        "pi-web:settings-return",
        window.location.pathname + window.location.search,
      );
    } catch {
      // ignore
    }
  };

  const settingsBtn = (
    <a
      href="/settings"
      data-settings-link
      onClick={goSettings}
      aria-label={t("chatApp.settings")}
      title={t("chatApp.settings")}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[7px] text-[hsl(var(--muted-foreground))] transition-colors hover:bg-[hsl(var(--surface-subtle))] hover:text-[hsl(var(--foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
    >
      <SettingsGlyph />
    </a>
  );

  // 未启用/加载中:只留设置入口,不占账户名。
  if (state.kind === "disabled" || state.kind === "loading") {
    return (
      <div
        data-launcher-account
        className={`flex shrink-0 items-center justify-end border-t border-[hsl(var(--border))] px-1.5 pb-0.5 pt-2 ${className ?? ""}`}
      >
        {settingsBtn}
      </div>
    );
  }

  if (state.kind === "anonymous") {
    if (!state.canExchange) {
      return (
        <div
          data-launcher-account
          className={`flex shrink-0 items-center justify-end border-t border-[hsl(var(--border))] px-1.5 pb-0.5 pt-2 ${className ?? ""}`}
        >
          {settingsBtn}
        </div>
      );
    }
    if (formOpen) {
      return (
        <div
          data-launcher-account
          className={`border-t border-[hsl(var(--border))] px-1.5 pb-1 pt-2 ${className ?? ""}`}
        >
          <LoginForm
            testIdPrefix="login"
            methods={identity.methods}
            onSubmit={async (email, password) => {
              const r = await identity.exchange(email, password);
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
        </div>
      );
    }
    return (
      <div
        ref={rootRef}
        data-launcher-account
        className={`flex shrink-0 items-center gap-1 border-t border-[hsl(var(--border))] px-1.5 pb-0.5 pt-2 ${className ?? ""}`}
      >
        <button
          type="button"
          data-testid="login-open"
          onClick={() => setFormOpen(true)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left transition-colors hover:bg-[hsl(var(--surface-subtle))]"
        >
          <Avatar label="?" />
          <span className="min-w-0 truncate text-sm font-medium text-[hsl(var(--foreground))]">
            登录
          </span>
        </button>
        {settingsBtn}
      </div>
    );
  }

  // authenticated
  const displayName = tenantDisplayName(state.tenant);
  const company =
    state.tenant.companyId.length > 0 ? state.tenant.companyId : undefined;

  return (
    <div
      ref={rootRef}
      data-launcher-account
      data-testid="login-status"
      className={`relative flex shrink-0 items-center gap-1 border-t border-[hsl(var(--border))] px-1.5 pb-0.5 pt-2 ${className ?? ""}`}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        data-account-menu-trigger
        onClick={() => setMenuOpen((v) => !v)}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-[10px] px-1.5 py-1.5 text-left transition-colors hover:bg-[hsl(var(--surface-subtle))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--ring))]"
      >
        <Avatar label={displayName} />
        <span className="flex min-w-0 flex-1 flex-col gap-0">
          <span
            data-testid="login-user"
            title={state.tenant.userId}
            className="truncate text-sm font-medium leading-snug text-[hsl(var(--foreground))]"
          >
            {displayName}
          </span>
          {company !== undefined ? (
            <span
              data-testid="login-company"
              className="truncate text-[11px] leading-tight text-[hsl(var(--muted-foreground))]"
            >
              {company}
            </span>
          ) : null}
        </span>
      </button>

      {settingsBtn}

      {menuOpen ? (
        <div
          role="menu"
          data-account-menu
          className="absolute bottom-[calc(100%+6px)] left-1.5 right-1.5 z-50 overflow-hidden rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-1.5 text-[hsl(var(--popover-foreground))] shadow-lg"
        >
          <div className="mb-1 flex items-center gap-2.5 rounded-[7px] px-2.5 py-2">
            <Avatar label={displayName} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{displayName}</div>
              {company !== undefined ? (
                <div className="truncate text-[11px] text-[hsl(var(--muted-foreground))]">
                  {company}
                </div>
              ) : null}
            </div>
          </div>
          <div className="my-1 h-px bg-[hsl(var(--border))]" />

          {identity.needsReauth ? (
            <div
              data-testid="login-needs-reauth"
              className="px-2.5 py-1 text-xs text-[hsl(var(--destructive))]"
            >
              需重新登录
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            data-testid="bind-phone-open"
            className={MENU_ITEM}
            onClick={() => {
              setMenuOpen(false);
              setBindPhoneOpen(true);
            }}
          >
            绑定手机
          </button>
          {identity.needsReauth && state.canExchange ? (
            <button
              type="button"
              role="menuitem"
              data-testid="login-reauth"
              className={MENU_ITEM}
              onClick={() => {
                setMenuOpen(false);
                setFormOpen(true);
              }}
            >
              重新登录
            </button>
          ) : null}

          {theme !== null ? (
            <button
              type="button"
              role="menuitem"
              data-pi-theme-toggle
              aria-label={
                theme.isDark ? t("themeControls.toLight") : t("themeControls.toDark")
              }
              className={MENU_ITEM}
              onClick={() => theme.toggle()}
            >
              <span className="flex-1">外观</span>
              <span
                className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]"
                aria-hidden
              >
                {theme.isDark ? <SunGlyph /> : <MoonGlyph />}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            data-pi-locale-toggle
            className={MENU_ITEM}
            onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
          >
            <span className="flex-1">语言</span>
            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center text-xs font-medium text-[hsl(var(--muted-foreground))]">
              {locale === "zh" ? "EN" : "中"}
            </span>
          </button>

          <div className="my-1 h-px bg-[hsl(var(--border))]" />
          <button
            type="button"
            role="menuitem"
            data-testid="logout"
            className={MENU_ITEM}
            onClick={() => {
              setMenuOpen(false);
              void identity.revoke();
            }}
          >
            <span className="flex-1">退出登录</span>
            <span
              className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-[hsl(var(--muted-foreground))]"
              aria-hidden
            >
              <LogoutGlyph />
            </span>
          </button>
        </div>
      ) : null}

      {formOpen && state.canExchange ? (
        <div className="absolute bottom-[calc(100%+6px)] left-1.5 right-1.5 z-50 rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-3 shadow-lg">
          <LoginForm
            testIdPrefix="reauth"
            methods={identity.methods}
            onSubmit={async (email, password) => {
              const r = await identity.exchange(email, password);
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
            onWechatPoll={(s) => identity.pollWechat(s)}
            onWechatExchange={async (s, c) => {
              const r = await identity.exchangeWechat(s, c);
              if (r.ok) setFormOpen(false);
              return r;
            }}
            onCancel={() => setFormOpen(false)}
          />
        </div>
      ) : null}

      {bindPhoneOpen ? (
        <div className="absolute bottom-[calc(100%+6px)] left-1.5 right-1.5 z-50 rounded-[12px] border border-[hsl(var(--border))] bg-[hsl(var(--popover))] p-3 shadow-lg">
          <BindPhoneForm
            onSend={(phone) => identity.bindPhoneSend(phone)}
            onVerify={(phone, code) => identity.bindPhoneVerify(phone, code)}
          />
          <button
            type="button"
            className="mt-2 w-full rounded-[7px] border border-border px-2 py-1 text-xs hover:bg-accent"
            onClick={() => setBindPhoneOpen(false)}
          >
            关闭
          </button>
        </div>
      ) : null}
    </div>
  );
}

function iconSvg(paths: React.ReactNode): React.JSX.Element {
  return (
    <svg
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths}
    </svg>
  );
}

function SettingsGlyph(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M21 4h-7" />
      <path d="M10 4H3" />
      <path d="M21 12h-9" />
      <path d="M8 12H3" />
      <path d="M21 20h-5" />
      <path d="M12 20H3" />
      <path d="M14 2v4" />
      <path d="M8 10v4" />
      <path d="M16 18v4" />
    </>,
  );
}

function MoonGlyph(): React.JSX.Element {
  return iconSvg(<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />);
}

function SunGlyph(): React.JSX.Element {
  return iconSvg(
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </>,
  );
}

function LogoutGlyph(): React.JSX.Element {
  return iconSvg(
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>,
  );
}

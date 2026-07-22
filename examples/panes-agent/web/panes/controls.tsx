import * as React from "react";

export function Button({ tone = "default", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { readonly tone?: "default" | "primary" | "danger" }): React.JSX.Element {
  return <button {...props} className={["button", `button-${tone}`, props.className].filter(Boolean).join(" ")} />;
}

export function Dialog({ title, open, onClose, children, actions }: {
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: React.ReactNode;
  readonly actions?: React.ReactNode;
}): React.JSX.Element | null {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, open]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header className="dialog-header"><strong>{title}</strong><Button aria-label="关闭" onClick={onClose}>×</Button></header>
        <div className="dialog-body">{children}</div>
        {actions !== undefined ? <footer className="dialog-actions">{actions}</footer> : null}
      </section>
    </div>
  );
}

export function Toolbar({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <header className="toolbar">{children}</header>;
}

export function Notice({ tone = "muted", children }: { readonly tone?: "muted" | "ok" | "error"; readonly children: React.ReactNode }): React.JSX.Element {
  return <p className={`notice ${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</p>;
}

export function Spinner(): React.JSX.Element {
  return <span className="spinner" aria-label="加载中" />;
}

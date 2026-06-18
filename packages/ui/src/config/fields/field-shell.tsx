/**
 * FieldShell — 字段外壳:label(required 星号)+ 描述 + 错误就地呈现。
 * 复用 pi-permission-dialog 的错误展示风格(role="alert")。
 */
import * as React from "react";
import type { FieldDescriptor } from "@pi-web/protocol";
import { cn } from "../../lib/cn.js";

export interface FieldShellProps {
  readonly descriptor: FieldDescriptor;
  readonly htmlFor?: string;
  readonly error?: string;
  readonly children: React.ReactNode;
  readonly className?: string;
}

export function FieldShell({
  descriptor,
  htmlFor,
  error,
  children,
  className,
}: FieldShellProps): React.JSX.Element {
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-pi-field={descriptor.key}>
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-[hsl(var(--foreground))]"
      >
        {descriptor.label}
        {descriptor.required ? (
          <span className="ml-0.5 text-[hsl(var(--destructive))]" aria-hidden>
            *
          </span>
        ) : null}
      </label>
      {descriptor.description !== undefined ? (
        <p className="text-xs text-[hsl(var(--muted-foreground))]">
          {descriptor.description}
        </p>
      ) : null}
      {children}
      {error !== undefined ? (
        <p role="alert" className="text-xs text-[hsl(var(--destructive))]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 取本字段在 errors 表中的错误(按点路径)。 */
export function errorAt(
  errors: Readonly<Record<string, string>>,
  path: readonly string[],
): string | undefined {
  return errors[path.join(".")];
}

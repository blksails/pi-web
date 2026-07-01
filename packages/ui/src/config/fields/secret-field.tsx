/**
 * SecretField — 凭证字段(kind:"secret")。
 *
 * 读:接收 `SecretMask`(不含明文)。已设置 → 展示掩码占位 + [更换]/[清除];
 * 未设置 → 直接显示输入框。写:产出 `SecretWrite`(keep/clear/set)。明文绝不展示已存值。
 */
import * as React from "react";
import {
  isSecretMask,
  isSecretWrite,
  secretKeep,
  secretClear,
  secretSet,
  type SecretMask,
} from "@blksails/pi-web-protocol";
import type { FieldProps } from "../field-registry.js";
import { Input } from "../../ui/input.js";
import { Button } from "../../ui/button.js";
import { FieldShell, errorAt } from "./field-shell.js";
import { useI18n } from "../../i18n/index.js";

type Mode = "idle" | "editing" | "cleared";

function maskOf(value: unknown): SecretMask {
  if (isSecretMask(value)) return value;
  // 已是写动作或空:无掩码信息,视为未设置(展示输入)。
  if (isSecretWrite(value) && value.action === "keep") {
    return { __secret: true, set: true };
  }
  return { __secret: true, set: false };
}

export function SecretField({
  descriptor,
  value,
  onChange,
  path,
  errors,
  disabled,
}: FieldProps): React.JSX.Element {
  const t = useI18n();
  const id = React.useId();
  const error = errorAt(errors, path);
  const [mask] = React.useState<SecretMask>(() => maskOf(value));
  const [mode, setMode] = React.useState<Mode>(mask.set ? "idle" : "editing");
  const [text, setText] = React.useState("");

  const masked = mask.set
    ? `${t("config.secret.set")}${mask.hint ?? ""}`
    : t("config.secret.unset");

  return (
    <FieldShell descriptor={descriptor} htmlFor={id} error={error}>
      {mode === "idle" ? (
        <div className="flex items-center gap-2">
          <span
            className="flex-1 text-sm text-[hsl(var(--muted-foreground))]"
            data-pi-secret-state
          >
            {masked}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setMode("editing");
              setText("");
              onChange(secretKeep);
            }}
          >
            {t("config.secret.change")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={disabled}
            onClick={() => {
              setMode("cleared");
              onChange(secretClear);
            }}
          >
            {t("config.secret.clear")}
          </Button>
        </div>
      ) : null}

      {mode === "editing" ? (
        <div className="flex items-center gap-2">
          <Input
            id={id}
            type="password"
            value={text}
            placeholder={descriptor.placeholder ?? t("config.secret.newValuePlaceholder")}
            disabled={disabled}
            aria-invalid={error !== undefined}
            onChange={(e) => {
              const next = e.target.value;
              setText(next);
              onChange(next.length > 0 ? secretSet(next) : secretKeep);
            }}
          />
          {mask.set ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setMode("idle");
                setText("");
                onChange(secretKeep);
              }}
            >
              {t("common.cancel")}
            </Button>
          ) : null}
        </div>
      ) : null}

      {mode === "cleared" ? (
        <div className="flex items-center gap-2">
          <span className="flex-1 text-sm text-[hsl(var(--destructive))]">
            {t("config.secret.willClear")}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setMode(mask.set ? "idle" : "editing");
              onChange(secretKeep);
            }}
          >
            {t("config.secret.undo")}
          </Button>
        </div>
      ) : null}
    </FieldShell>
  );
}

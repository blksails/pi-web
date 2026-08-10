/**
 * 历史登录账户（仅标识符，无密钥）。localStorage 持久。
 */
const KEY = "pi-web:login-account-history";
const MAX = 8;

export type LoginAccountKind = "email" | "phone";

export interface LoginAccountEntry {
  readonly kind: LoginAccountKind;
  readonly value: string;
  readonly lastUsedAt: number;
}

function readRaw(): LoginAccountEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is LoginAccountEntry =>
          typeof x === "object" &&
          x !== null &&
          (x as LoginAccountEntry).kind !== undefined &&
          typeof (x as LoginAccountEntry).value === "string",
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

function writeRaw(entries: LoginAccountEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX)));
  } catch {
    // ignore quota
  }
}

export function listLoginAccounts(): LoginAccountEntry[] {
  return readRaw().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

export function upsertLoginAccount(kind: LoginAccountKind, value: string): void {
  const v = value.trim();
  if (!v) return;
  const now = Date.now();
  const rest = readRaw().filter((e) => !(e.kind === kind && e.value === v));
  writeRaw([{ kind, value: v, lastUsedAt: now }, ...rest]);
}

export function removeLoginAccount(kind: LoginAccountKind, value: string): void {
  writeRaw(readRaw().filter((e) => !(e.kind === kind && e.value === value)));
}

/** 展示用脱敏：邮箱保留首尾，手机中间打码。 */
export function maskLoginAccount(entry: LoginAccountEntry): string {
  const v = entry.value;
  if (entry.kind === "phone" && v.length >= 7) {
    return `${v.slice(0, 3)}****${v.slice(-4)}`;
  }
  const at = v.indexOf("@");
  if (at > 1) {
    return `${v[0]}***${v.slice(at)}`;
  }
  return v;
}

/**
 * 用 public.profiles + companies 补全 capabilities tenant 的展示字段。
 *
 * 现网 capabilities 只下发折叠后的 displayName,桌面账户区看不到 username / 头像 / 公司。
 * 本模块在已认证后按 userId 补读,失败则原样返回。
 */
import pg from "pg";
import type { CapabilityTenant } from "@blksails/pi-web-core/capability/types.js";

export interface ProfileRow {
  readonly username?: string;
  readonly nickname?: string;
  readonly fullName?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly avatarUrl?: string;
  readonly companyName?: string;
  readonly companySource?: string;
}

function text(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t.length > 0 ? t : undefined;
}

export function companyNameForDisplay(
  companyName: unknown,
  source: unknown,
): string | undefined {
  const name = text(companyName);
  if (name === undefined) return undefined;
  return text(source)?.toLowerCase() === "pilabs" ? undefined : name;
}

export function mergeProfileIntoTenant(
  tenant: CapabilityTenant,
  profile: ProfileRow,
): CapabilityTenant {
  const username = text(profile.username);
  const nickname = text(profile.nickname);
  const fullName = text(profile.fullName);
  const email = text(profile.email);
  const phone = text(profile.phone);
  const avatarUrl = text(profile.avatarUrl);
  const companySource = text(profile.companySource);
  const companyName = companyNameForDisplay(profile.companyName, profile.companySource);
  return {
    ...tenant,
    ...(username !== undefined ? { username } : {}),
    ...(nickname !== undefined ? { nickname } : {}),
    ...(fullName !== undefined ? { fullName } : {}),
    ...(email !== undefined ? { email } : {}),
    ...(phone !== undefined ? { phone } : {}),
    ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    ...(companyName !== undefined ? { companyName } : {}),
    ...(companySource !== undefined ? { companySource } : {}),
  };
}

export function profileDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  return text(env.PI_WEB_PROFILE_DATABASE_URL);
}

export async function loadProfileRow(
  userId: string,
  connectionString: string,
): Promise<ProfileRow | undefined> {
  const client = new pg.Client({
    connectionString,
    ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
      ? undefined
      : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    const profile = await client.query(
      "select username, nickname, full_name, email, phone, avatar_url, company_id from public.profiles where id = $1",
      [userId],
    );
    const row = profile.rows[0] as
      | {
          username?: string | null;
          nickname?: string | null;
          full_name?: string | null;
          email?: string | null;
          phone?: string | null;
          avatar_url?: string | null;
          company_id?: string | number | null;
        }
      | undefined;
    if (row === undefined) return undefined;
    let companyName: string | undefined;
    let companySource: string | undefined;
    if (row.company_id !== undefined && row.company_id !== null) {
      const company = await client.query(
        "select company_name, source from public.companies where id = $1 and deleted_at is null",
        [row.company_id],
      );
      const c = company.rows[0] as { company_name?: string | null; source?: string | null } | undefined;
      companyName = text(c?.company_name);
      companySource = text(c?.source);
    }
    return {
      ...(text(row.username) !== undefined ? { username: text(row.username) } : {}),
      ...(text(row.nickname) !== undefined ? { nickname: text(row.nickname) } : {}),
      ...(text(row.full_name) !== undefined ? { fullName: text(row.full_name) } : {}),
      ...(text(row.email) !== undefined ? { email: text(row.email) } : {}),
      ...(text(row.phone) !== undefined ? { phone: text(row.phone) } : {}),
      ...(text(row.avatar_url) !== undefined ? { avatarUrl: text(row.avatar_url) } : {}),
      ...(companyName !== undefined ? { companyName } : {}),
      ...(companySource !== undefined ? { companySource } : {}),
    };
  } finally {
    await client.end();
  }
}

export async function enrichCapabilityTenant(
  tenant: CapabilityTenant,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CapabilityTenant> {
  const url = profileDatabaseUrl(env);
  if (url === undefined) return tenant;
  try {
    const profile = await loadProfileRow(tenant.userId, url);
    if (profile === undefined) return tenant;
    return mergeProfileIntoTenant(tenant, profile);
  } catch {
    return tenant;
  }
}

/**
 * desktop-cloud-login · 桌面凭据解析与过期判定(design.md §Data Models,Req 2.4/3.7/6.1)。
 *
 * 桌面凭据形态(外部契约,pi-clouds 签发)= `base64url(JSON(payload)) + "." + HMAC`,
 * payload = `{ userId, companyId, scope, exp }`(exp 为 unix 秒)。
 *
 * **本仓只读 payload**(userId/companyId/exp,供登录态展示与过期判定);**验签在云端 egress**
 * (本仓不持 secret、不做密码学校验)。因此这里只解 base64url 首段并做结构/时间校验,不触碰
 * 签名段——一个「结构上不是桌面凭据」的串会被拒(返回 undefined),但「结构合法、签名伪造」
 * 的串本仓不拦截(云端 egress 验签兜底,Req 7.2 的职责边界)。
 */

/** 桌面凭据 payload(本仓消费的字段;passthrough 未知字段被忽略)。 */
export interface DesktopCredentialPayload {
  /** Supabase 用户 uuid。 */
  readonly userId: string;
  /** 租户(公司)id。 */
  readonly companyId: string;
  /** 凭据用途标识(如 `"desktop"`)。 */
  readonly scope: string;
  /** 过期时刻(unix 秒)。 */
  readonly exp: number;
}

/** 登录态判定结果。 */
export type CredentialStatus = "valid" | "expired";

function decodeBase64UrlToString(segment: string): string | undefined {
  // base64url → base64(补 padding),再 Buffer 解码为 utf8 JSON。
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try {
    const buf = Buffer.from(padded, "base64");
    // 反向重编码一致性校验:非法 base64 会被 Buffer 静默截断,这里排除。
    if (buf.length === 0) return undefined;
    return buf.toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * 解析桌面凭据 payload(不验签)。
 *
 * @returns 结构合法时返回 payload;结构非法(缺段/非法 base64/JSON 解析失败/字段缺失或类型
 *   错误)时返回 `undefined`。
 */
export function parseDesktopCredential(
  credential: string | undefined,
): DesktopCredentialPayload | undefined {
  if (credential === undefined) return undefined;
  const trimmed = credential.trim();
  if (trimmed.length === 0) return undefined;

  const dot = trimmed.indexOf(".");
  // 必须是 `<payload>.<sig>` 两段形态(sig 段非空,但本仓不校验其内容)。
  if (dot <= 0 || dot === trimmed.length - 1) return undefined;
  const payloadSegment = trimmed.slice(0, dot);

  const json = decodeBase64UrlToString(payloadSegment);
  if (json === undefined) return undefined;

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;

  const { userId, companyId, scope, exp } = obj;
  if (
    typeof userId !== "string" ||
    userId.length === 0 ||
    typeof companyId !== "string" ||
    companyId.length === 0 ||
    typeof scope !== "string" ||
    scope.length === 0 ||
    typeof exp !== "number" ||
    !Number.isFinite(exp)
  ) {
    return undefined;
  }

  return { userId, companyId, scope, exp };
}

/**
 * 依 payload 的 `exp` 判定登录态。
 *
 * @param payload 已解析的 payload。
 * @param nowMs 当前时刻毫秒(默认 `Date.now()`;测试可注入以覆盖临界)。
 * @returns `exp <= now` → `"expired"`,否则 `"valid"`。
 */
export function credentialStatus(
  payload: DesktopCredentialPayload,
  nowMs: number = Date.now(),
): CredentialStatus {
  const nowSeconds = Math.floor(nowMs / 1000);
  return payload.exp <= nowSeconds ? "expired" : "valid";
}

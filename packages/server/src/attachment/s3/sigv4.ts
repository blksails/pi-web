/**
 * attachment · S3 兼容后端 · AWS Signature Version 4 纯函数(`attachment-backend-pluggable` spec,
 * 任务 4.1;Req 5.1, 5.4)。
 *
 * 零 IO 的签名算法实现(canonical request → string-to-sign → signing key → header 签名 /
 * query presign),仅依赖 `node:crypto`(design.md Allowed Dependencies:禁止新增第三方运行时依赖,
 * 含 AWS SDK)。算法与 AWS 官方文档「Signature Version 4 signing process」逐步对齐;正确性锚点
 * 见单测钉的 AWS 官方发布的签名向量(`Examples of the Complete Version 4 Signing Process`)。
 */
import { createHash, createHmac } from "node:crypto";

/** SigV4 固定算法标识。 */
export const SIGV4_ALGORITHM = "AWS4-HMAC-SHA256";

/** SHA256(空字符串)的十六进制摘要;GET 等无 body 请求的 payload hash 惯用值。 */
export const EMPTY_PAYLOAD_HASH =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

/** 未签名 payload 的占位值(presign 场景惯用,S3 接受)。 */
export const UNSIGNED_PAYLOAD = "UNSIGNED-PAYLOAD";

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Uint8Array | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * AWS 专属 URI 百分号编码:仅 `A-Za-z0-9-_.~` 不编码,其余(含空格/`/`等)按字节编码为 `%XX`(大写)。
 * `encodeSlashes=false`(默认路径场景)时 `/` 原样保留(路径分隔符不编码);查询串键/值编码时
 * 传 `true` 使 `/` 也被编码(AWS 规范:查询串的编码与路径编码的区别仅在 `/`)。
 */
export function awsUriEncode(input: string, encodeSlashes = false): string {
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-_.~]/.test(ch)) {
      out += ch;
    } else if (ch === "/" && !encodeSlashes) {
      out += "/";
    } else {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/** 规范化 URI 路径:按 `/` 切分逐段编码(段内 `/` 已被切分,不会被二次编码)。 */
export function canonicalUri(path: string): string {
  if (path === "" || path === "/") return "/";
  const segments = path.split("/").map((seg) => awsUriEncode(seg, true));
  return segments.join("/");
}

/** 规范化查询字符串:键值均 URI 编码,按编码后的键(再按值)升序排序,`key=value` 以 `&` 连接。 */
export function canonicalQueryString(
  query: Record<string, string> | URLSearchParams,
): string {
  const pairs: Array<[string, string]> =
    query instanceof URLSearchParams
      ? [...query.entries()]
      : Object.entries(query);
  const encoded = pairs.map(
    ([k, v]) => [awsUriEncode(k, true), awsUriEncode(v, true)] as [string, string],
  );
  encoded.sort(([ka, va], [kb, vb]) => (ka === kb ? (va < vb ? -1 : va > vb ? 1 : 0) : ka < kb ? -1 : 1));
  return encoded.map(([k, v]) => `${k}=${v}`).join("&");
}

/** 规范化请求头:小写 header 名、trim 值、按 header 名升序,每行 `name:value\n`。 */
export function canonicalHeaders(headers: Record<string, string>): string {
  const entries = Object.entries(headers).map(
    ([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as [string, string],
  );
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return entries.map(([k, v]) => `${k}:${v}\n`).join("");
}

/** 已签名 header 名列表:小写、按字典序、`;` 连接。 */
export function signedHeadersList(headers: Record<string, string>): string {
  return Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(";");
}

export interface CanonicalRequestInput {
  readonly method: string;
  readonly path: string;
  readonly query?: Record<string, string> | URLSearchParams;
  readonly headers: Record<string, string>;
  readonly payloadHash: string;
}

/** 构造 AWS SigV4 canonical request 字符串。 */
export function canonicalRequest(input: CanonicalRequestInput): string {
  const query = input.query ?? {};
  return [
    input.method.toUpperCase(),
    canonicalUri(input.path),
    canonicalQueryString(query),
    canonicalHeaders(input.headers),
    signedHeadersList(input.headers),
    input.payloadHash,
  ].join("\n");
}

export interface CredentialScope {
  readonly date: string; // YYYYMMDD
  readonly region: string;
  readonly service: string;
}

/** `<date>/<region>/<service>/aws4_request`。 */
export function credentialScope(scope: CredentialScope): string {
  return `${scope.date}/${scope.region}/${scope.service}/aws4_request`;
}

/** 构造 SigV4 string-to-sign(`AWS4-HMAC-SHA256\n<amzDate>\n<scope>\n<hex(sha256(canonicalRequest))>`)。 */
export function stringToSign(
  amzDate: string,
  scope: CredentialScope,
  canonicalReq: string,
): string {
  return [
    SIGV4_ALGORITHM,
    amzDate,
    credentialScope(scope),
    sha256Hex(canonicalReq),
  ].join("\n");
}

/**
 * 派生签名密钥:`HMAC(HMAC(HMAC(HMAC("AWS4"+secret, date), region), service), "aws4_request")`。
 */
export function signingKey(secretKey: string, scope: CredentialScope): Buffer {
  const kDate = hmac("AWS4" + secretKey, scope.date);
  const kRegion = hmac(kDate, scope.region);
  const kService = hmac(kRegion, scope.service);
  return hmac(kService, "aws4_request");
}

/** 对 string-to-sign 计算最终十六进制签名。 */
export function computeSignature(
  secretKey: string,
  scope: CredentialScope,
  stringToSignValue: string,
): string {
  return hmac(signingKey(secretKey, scope), stringToSignValue).toString("hex");
}

export interface SignHeadersInput {
  readonly method: string;
  readonly path: string;
  readonly query?: Record<string, string> | URLSearchParams;
  readonly headers: Record<string, string>;
  readonly payloadHash: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly amzDate: string; // YYYYMMDDTHHMMSSZ
  readonly region: string;
  readonly service: string;
}

/** header 签名(SigV4 authorization header 流程)结果。 */
export interface SignHeadersResult {
  readonly authorization: string;
  readonly signature: string;
  readonly signedHeaders: string;
  readonly credentialScope: string;
}

/**
 * header 签名:构造 canonical request → string-to-sign → 签名,拼出 `Authorization` header 值。
 */
export function signHeaders(input: SignHeadersInput): SignHeadersResult {
  const date = input.amzDate.slice(0, 8);
  const scope: CredentialScope = { date, region: input.region, service: input.service };
  const canonicalReq = canonicalRequest({
    method: input.method,
    path: input.path,
    query: input.query,
    headers: input.headers,
    payloadHash: input.payloadHash,
  });
  const sts = stringToSign(input.amzDate, scope, canonicalReq);
  const signature = computeSignature(input.secretAccessKey, scope, sts);
  const signedHeaders = signedHeadersList(input.headers);
  const scopeStr = credentialScope(scope);
  const authorization =
    `${SIGV4_ALGORITHM} Credential=${input.accessKeyId}/${scopeStr}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, signature, signedHeaders, credentialScope: scopeStr };
}

export interface PresignQueryInput {
  readonly method: string;
  readonly path: string;
  readonly host: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly amzDate: string; // YYYYMMDDTHHMMSSZ
  readonly region: string;
  readonly service: string;
  readonly expiresInSeconds: number;
  readonly extraQuery?: Record<string, string>;
  readonly sessionToken?: string;
}

/**
 * query presign(可直链访问的签名 URL 查询串):在查询串中放入 `X-Amz-*` 参数(不含 Signature)
 * 参与签名,最终返回含 `X-Amz-Signature` 的完整查询串。payload hash 固定 {@link UNSIGNED_PAYLOAD}
 * (presign 惯用,S3 接受),仅签名 `host` header。
 */
export function presignQuery(input: PresignQueryInput): string {
  const date = input.amzDate.slice(0, 8);
  const scope: CredentialScope = { date, region: input.region, service: input.service };
  const credential = `${input.accessKeyId}/${credentialScope(scope)}`;
  const headers = { host: input.host };
  const query: Record<string, string> = {
    "X-Amz-Algorithm": SIGV4_ALGORITHM,
    "X-Amz-Credential": credential,
    "X-Amz-Date": input.amzDate,
    "X-Amz-Expires": String(input.expiresInSeconds),
    "X-Amz-SignedHeaders": signedHeadersList(headers),
    ...(input.sessionToken !== undefined
      ? { "X-Amz-Security-Token": input.sessionToken }
      : {}),
    ...input.extraQuery,
  };
  const canonicalReq = canonicalRequest({
    method: input.method,
    path: input.path,
    query,
    headers,
    payloadHash: UNSIGNED_PAYLOAD,
  });
  const sts = stringToSign(input.amzDate, scope, canonicalReq);
  const signature = computeSignature(input.secretAccessKey, scope, sts);
  const finalQuery = canonicalQueryString({ ...query, "X-Amz-Signature": signature });
  return finalQuery;
}

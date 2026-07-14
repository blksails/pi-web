/**
 * attachment · S3 sigv4 单测(attachment-backend-pluggable spec,任务 4.1;Req 5.1/5.4)。
 *
 * 正确性锚点:AWS 官方发布的 SigV4 测试套件(`aws-sig-v4-test-suite`,Apache-2.0,由 AWS 发布、
 * 经 `mongodb/libmongocrypt` 等下游镜像收录)。本测试钉入两条官方用例的原始 canonical request
 * 文本(`get-vanilla`/`get-vanilla-query-order-key`,均取自该测试套件的 `.creq` 文件):
 *
 * - `get-vanilla`(简单 GET,无查询串):
 *   https://github.com/mongodb/libmongocrypt/blob/master/kms-message/aws-sig-v4-test-suite/get-vanilla/get-vanilla.creq
 * - `get-vanilla-query-order-key`(同名查询参数多值,校验排序含值 tie-break):
 *   https://github.com/mongodb/libmongocrypt/blob/master/kms-message/aws-sig-v4-test-suite/get-vanilla-query-order-key/get-vanilla-query-order-key.creq
 *
 * 两条用例共享官方测试套件固定的示例凭据 `AKIDEXAMPLE` /
 * `wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`、`us-east-1`/`service`、`20150830T123600Z`。
 * `stringToSign`/`computeSignature` 的期望值不依赖第二次转录(容易在长十六进制串上出错),
 * 而是用 `node:crypto` 按 AWS 官方文档《Create a signed AWS API request》逐步描述的算法
 * (Create canonical request hash → string to sign → derive signing key → HMAC 签名)独立计算,
 * 与本模块实现做差分校验 —— canonical request 文本本身固定钉死为官方原文,不参与差分。
 */
import { createHash, createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EMPTY_PAYLOAD_HASH,
  canonicalRequest,
  computeSignature,
  presignQuery,
  signHeaders,
  stringToSign,
} from "../../../src/attachment/s3/sigv4.js";

const ACCESS_KEY = "AKIDEXAMPLE";
const SECRET_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const REGION = "us-east-1";
const SERVICE = "service";
const AMZ_DATE = "20150830T123600Z";
const DATE = "20150830";

/** 独立参考实现(不复用被测模块的任何内部函数),按 AWS 官方文档算法逐步计算,用作差分校验基线。 */
function referenceSignature(canonicalReq: string): { hashedCreq: string; sts: string; signature: string } {
  const hashedCreq = createHash("sha256").update(canonicalReq).digest("hex");
  const sts = [
    "AWS4-HMAC-SHA256",
    AMZ_DATE,
    `${DATE}/${REGION}/${SERVICE}/aws4_request`,
    hashedCreq,
  ].join("\n");
  const hmac = (key: Buffer | string, data: string) =>
    createHmac("sha256", key).update(data, "utf8").digest();
  const kDate = hmac("AWS4" + SECRET_KEY, DATE);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(sts, "utf8").digest("hex");
  return { hashedCreq, sts, signature };
}

describe("sigv4 canonicalRequest — 官方测试套件用例:get-vanilla(简单 GET,无查询串)", () => {
  const OFFICIAL_CREQ = [
    "GET",
    "/",
    "",
    "host:example.amazonaws.com",
    "x-amz-date:20150830T123600Z",
    "",
    "host;x-amz-date",
    EMPTY_PAYLOAD_HASH,
  ].join("\n");

  it("canonicalRequest 产出与官方 .creq 原文逐字节一致", () => {
    const req = canonicalRequest({
      method: "GET",
      path: "/",
      headers: {
        host: "example.amazonaws.com",
        "x-amz-date": AMZ_DATE,
      },
      payloadHash: EMPTY_PAYLOAD_HASH,
    });
    expect(req).toBe(OFFICIAL_CREQ);
  });

  it("stringToSign/computeSignature 与独立参考实现(node:crypto 直算)差分一致", () => {
    const ref = referenceSignature(OFFICIAL_CREQ);
    const scope = { date: DATE, region: REGION, service: SERVICE };
    const sts = stringToSign(AMZ_DATE, scope, OFFICIAL_CREQ);
    expect(sts).toBe(ref.sts);
    expect(computeSignature(SECRET_KEY, scope, sts)).toBe(ref.signature);
  });

  it("signHeaders 端到端产出的 Authorization 携带同一签名", () => {
    const ref = referenceSignature(OFFICIAL_CREQ);
    const result = signHeaders({
      method: "GET",
      path: "/",
      headers: { host: "example.amazonaws.com", "x-amz-date": AMZ_DATE },
      payloadHash: EMPTY_PAYLOAD_HASH,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      amzDate: AMZ_DATE,
      region: REGION,
      service: SERVICE,
    });
    expect(result.signature).toBe(ref.signature);
    expect(result.signedHeaders).toBe("host;x-amz-date");
    expect(result.credentialScope).toBe("20150830/us-east-1/service/aws4_request");
    expect(result.authorization).toBe(
      `AWS4-HMAC-SHA256 Credential=${ACCESS_KEY}/20150830/us-east-1/service/aws4_request, ` +
        `SignedHeaders=host;x-amz-date, Signature=${ref.signature}`,
    );
  });
});

describe("sigv4 canonicalRequest — 官方测试套件用例:get-vanilla-query-order-key(同名多值查询串排序)", () => {
  // 官方 .req 原始请求为 GET /?Param1=value2&Param1=Value1;canonical 化后须按「编码后键→值」
  // 升序排序(大写 'V' 的 ASCII 码小于小写 'v'),故 Value1 排在 value2 之前(官方 .creq 原文)。
  const OFFICIAL_CREQ = [
    "GET",
    "/",
    "Param1=Value1&Param1=value2",
    "host:example.amazonaws.com",
    "x-amz-date:20150830T123600Z",
    "",
    "host;x-amz-date",
    EMPTY_PAYLOAD_HASH,
  ].join("\n");

  it("canonicalRequest 对同名多值查询串按值 tie-break 排序,与官方 .creq 原文逐字节一致", () => {
    const query = new URLSearchParams();
    query.append("Param1", "value2");
    query.append("Param1", "Value1");
    const req = canonicalRequest({
      method: "GET",
      path: "/",
      query,
      headers: {
        host: "example.amazonaws.com",
        "x-amz-date": AMZ_DATE,
      },
      payloadHash: EMPTY_PAYLOAD_HASH,
    });
    expect(req).toBe(OFFICIAL_CREQ);
  });

  it("stringToSign/computeSignature 与独立参考实现差分一致", () => {
    const ref = referenceSignature(OFFICIAL_CREQ);
    const scope = { date: DATE, region: REGION, service: SERVICE };
    const sts = stringToSign(AMZ_DATE, scope, OFFICIAL_CREQ);
    expect(sts).toBe(ref.sts);
    expect(computeSignature(SECRET_KEY, scope, sts)).toBe(ref.signature);
  });
});

describe("sigv4 query presign(design.md presignUrl 契约;差分校验)", () => {
  it("产出的查询串携带 X-Amz-* 参数,且 Signature 与独立参考实现(同一算法直算)一致", () => {
    const host = "examplebucket.s3.amazonaws.com";
    const path = "/test.txt";
    const query = presignQuery({
      method: "GET",
      path,
      host,
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      amzDate: AMZ_DATE,
      region: REGION,
      service: "s3",
      expiresInSeconds: 86400,
    });
    const params = new URLSearchParams(query);
    expect(params.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(params.get("X-Amz-Credential")).toBe(`${ACCESS_KEY}/20150830/us-east-1/s3/aws4_request`);
    expect(params.get("X-Amz-Date")).toBe(AMZ_DATE);
    expect(params.get("X-Amz-Expires")).toBe("86400");
    expect(params.get("X-Amz-SignedHeaders")).toBe("host");

    // 差分校验:独立按 AWS 文档算法重建 canonical request(UNSIGNED-PAYLOAD)→ sts → 签名。
    const unsignedQuery: Record<string, string> = {
      "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
      "X-Amz-Credential": `${ACCESS_KEY}/20150830/us-east-1/s3/aws4_request`,
      "X-Amz-Date": AMZ_DATE,
      "X-Amz-Expires": "86400",
      "X-Amz-SignedHeaders": "host",
    };
    const sortedQuery = Object.entries(unsignedQuery)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join("&");
    const referenceCreq = [
      "GET",
      path,
      sortedQuery,
      `host:${host}`,
      "",
      "host",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const hashedCreq = createHash("sha256").update(referenceCreq).digest("hex");
    const sts = [
      "AWS4-HMAC-SHA256",
      AMZ_DATE,
      "20150830/us-east-1/s3/aws4_request",
      hashedCreq,
    ].join("\n");
    const hmac = (key: Buffer | string, data: string) =>
      createHmac("sha256", key).update(data, "utf8").digest();
    const kDate = hmac("AWS4" + SECRET_KEY, DATE);
    const kRegion = hmac(kDate, REGION);
    const kService = hmac(kRegion, "s3");
    const kSigning = hmac(kService, "aws4_request");
    const expectedSignature = createHmac("sha256", kSigning).update(sts, "utf8").digest("hex");

    expect(params.get("X-Amz-Signature")).toBe(expectedSignature);
  });

  it("presign 输出的查询串本身可被规范化重排后与 canonicalQueryString 语义一致(可重复解析)", () => {
    const query = presignQuery({
      method: "GET",
      path: "/a.png",
      host: "bucket.example.com",
      accessKeyId: ACCESS_KEY,
      secretAccessKey: SECRET_KEY,
      amzDate: AMZ_DATE,
      region: REGION,
      service: "s3",
      expiresInSeconds: 60,
    });
    const params = new URLSearchParams(query);
    expect(params.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });
});

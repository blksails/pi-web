/**
 * CloudLoginClient(spec: desktop-account-login,任务 3.2;Req 2.3/2.4/8.1)。
 *
 * 两组断言:
 *  1. **状态映射** —— 每一类失败对应一种用户处置(改密码重试 / 原样重试),映射错了
 *     用户就会被引导去做无用功。
 *  2. **脱敏** —— 密码绝不进 logger 的任何参数位。这条靠注释挡不住:下一个加调试日志的人
 *     会顺手把 body 打出来。故用探针机械钉住。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createCloudLoginClient,
  type CloudLoginFetch,
} from "../../src/auth/cloud-login-client.js";

const LOGIN_URL = "https://cloud.example/api/desktop/login";
const EMAIL = "user@example.com";
const PASSWORD = "s3cr3t-p@ssw0rd-unique-marker";

function clientWith(fetchImpl: CloudLoginFetch, timeoutMs = 50): ReturnType<typeof createCloudLoginClient> {
  return createCloudLoginClient({ loginUrl: LOGIN_URL, fetchImpl, timeoutMs });
}

function respond(status: number, body: unknown): CloudLoginFetch {
  return async () => ({
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

describe("成功路径", () => {
  // ★ 云端返回的字段名是 `token`。首版按 `credential` 解,真机上表现为「密码正确却报
  //   无法连接云端」—— 2xx 但字段对不上,落进「响应形状非预期」分支。
  //   事实源:被撤回的 7c184ed:packages/server/src/auth/signin-endpoint.ts。
  it("200 + { token } → ok(这是实测的云端形态)", async () => {
    const r = await clientWith(respond(200, { token: "  tok-xyz  " })).login({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(r).toEqual({ ok: true, credential: "tok-xyz" });
  });

  it("200 + { credential } → ok(兼容读位,防云端将来改名)", async () => {
    const r = await clientWith(respond(200, { credential: "  cred-xyz  " })).login({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(r).toEqual({ ok: true, credential: "cred-xyz" });
  });

  it("两者并存时以 token 为准", async () => {
    const r = await clientWith(respond(200, { token: "tok", credential: "cred" })).login({
      email: EMAIL,
      password: PASSWORD,
    });
    expect(r).toEqual({ ok: true, credential: "tok" });
  });

  it("请求体是 JSON { email, password },email 被 trim 而 password 不被 trim", async () => {
    let seenBody = "";
    await clientWith(async (_u, init) => {
      seenBody = init.body;
      return { status: 200, text: async () => JSON.stringify({ token: "c" }) };
    }).login({ email: `  ${EMAIL}  `, password: "  pw with spaces  " });
    // ★ 密码前后空格可能是密码的一部分,擅自 trim 会让合法密码登不上。
    expect(JSON.parse(seenBody)).toEqual({ email: EMAIL, password: "  pw with spaces  " });
  });
});

describe("状态映射(Req 2.3/2.4)", () => {
  it.each([
    ["401", respond(401, {}), "invalid-credentials"],
    // ★ 403 与 401 分开:账号密码是对的,是没有租户归属。归到 invalid-credentials
    //   会让用户反复试同一个正确密码。
    ["403", respond(403, {}), "no-membership"],
    ["400", respond(400, { error: "email and password required" }), "invalid-request"],
    ["422", respond(422, {}), "invalid-request"],
    ["500", respond(500, {}), "cloud-unreachable"],
    ["503", respond(503, {}), "cloud-unreachable"],
    ["响应非 JSON", respond(200, "<html>502 Bad Gateway</html>"), "cloud-unreachable"],
    ["200 但既无 token 也无 credential", respond(200, { ok: true }), "cloud-unreachable"],
    ["200 但 token 为空串", respond(200, { token: "   " }), "cloud-unreachable"],
    ["200 但 credential 为空串", respond(200, { credential: "   " }), "cloud-unreachable"],
  ] as const)("%s → %s", async (_n, fetchImpl, reason) => {
    const r = await clientWith(fetchImpl).login({ email: EMAIL, password: PASSWORD });
    expect(r).toEqual({ ok: false, reason });
  });

  it("网络异常 → cloud-unreachable(用户可原样重试)", async () => {
    const r = await clientWith(async () => {
      throw new Error("ECONNREFUSED");
    }).login({ email: EMAIL, password: PASSWORD });
    expect(r).toEqual({ ok: false, reason: "cloud-unreachable" });
  });

  it("超时 → cloud-unreachable,且 abort 信号确实被触发", async () => {
    let aborted = false;
    const r = await clientWith(
      (_u, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      20,
    ).login({ email: EMAIL, password: PASSWORD });
    expect(r).toEqual({ ok: false, reason: "cloud-unreachable" });
    expect(aborted).toBe(true);
  });

  it.each([
    ["空邮箱", "   ", PASSWORD],
    ["空密码", EMAIL, ""],
  ])("%s → invalid-request 且**根本不发请求**", async (_n, email, password) => {
    let called = 0;
    const r = await clientWith(async () => {
      called += 1;
      return { status: 200, text: async () => "{}" };
    }).login({ email, password });
    expect(r).toEqual({ ok: false, reason: "invalid-request" });
    expect(called).toBe(0);
  });

  it("loginUrl 为空 → cloud-unreachable,不崩", async () => {
    const c = createCloudLoginClient({
      loginUrl: "   ",
      fetchImpl: async () => ({ status: 200, text: async () => "{}" }),
    });
    await expect(c.login({ email: EMAIL, password: PASSWORD })).resolves.toEqual({
      ok: false,
      reason: "cloud-unreachable",
    });
  });
});

describe("★ 脱敏:密码绝不进日志(Req 8.1)", () => {
  const written: string[] = [];
  let spy: { mockRestore(): void } | undefined;

  beforeEach(() => {
    written.length = 0;
    // logger 的 Node sink 走 stderr;直接拦 process.stderr.write 才能覆盖到实际落地内容,
    // 比 mock logger 模块更接近真实失败形态(mock 会漏掉「有人改用 console.error」这一路)。
    spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    spy?.mockRestore();
  });

  it.each([
    ["成功", respond(200, { token: "tok-xyz" })],
    ["401", respond(401, { error: `bad password: ${PASSWORD}` })],
    ["500", respond(500, {})],
    ["非 JSON", respond(200, "garbage")],
  ] as const)("%s 路径下 stderr 不含密码", async (_n, fetchImpl) => {
    await clientWith(fetchImpl).login({ email: EMAIL, password: PASSWORD });
    const all = written.join("");
    expect(all).not.toContain(PASSWORD);
  });

  it("网络异常路径下 stderr 不含密码", async () => {
    await clientWith(async () => {
      throw new Error(`connect failed while sending ${PASSWORD}`);
    }).login({ email: EMAIL, password: PASSWORD });
    expect(written.join("")).not.toContain(PASSWORD);
  });
});

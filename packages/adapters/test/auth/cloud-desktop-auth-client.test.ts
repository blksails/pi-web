import { describe, expect, it } from "vitest";
import {
  createCloudDesktopAuthClient,
} from "../../src/auth/cloud-desktop-auth-client.js";
import type { CloudLoginFetch } from "../../src/auth/cloud-login-client.js";

const LOGIN_URL = "https://pi-cloud.example/api/desktop/login";

function response(status: number, body: unknown): { status: number; text(): Promise<string> } {
  return { status, text: async () => JSON.stringify(body) };
}

describe("CloudDesktopAuthClient", () => {
  it("微信轮询使用无 body 的 GET,避免 Node fetch 拒绝请求", async () => {
    const calls: Array<{ url: string; init: Parameters<CloudLoginFetch>[1] }> = [];
    const fetchImpl: CloudLoginFetch = async (url, init) => {
      calls.push({ url, init });
      return response(200, { status: "pending" });
    };
    const client = createCloudDesktopAuthClient({ loginUrl: LOGIN_URL, fetchImpl });

    await expect(client.pollWechat("pi-web:state")).resolves.toEqual({
      ok: true,
      status: "pending",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://pi-cloud.example/api/desktop/wechat/poll?state=pi-web%3Astate",
    );
    expect(calls[0]?.init.method).toBe("GET");
    expect(calls[0]?.init.body).toBeUndefined();
    expect(calls[0]?.init.headers["content-type"]).toBeUndefined();
  });

  it("微信轮询 ready 返回 token 供桌面身份交换", async () => {
    const fetchImpl: CloudLoginFetch = async () =>
      response(200, { status: "ready", token: "credential" });
    const client = createCloudDesktopAuthClient({ loginUrl: LOGIN_URL, fetchImpl });

    await expect(client.pollWechat("pi-web:state")).resolves.toEqual({
      ok: true,
      status: "ready",
      credential: "credential",
    });
  });
});

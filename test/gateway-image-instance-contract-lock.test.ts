/**
 * 契约互锁 — 网关会话实例 env 的两个解析器必须读出同一结果
 * (spec desktop-aigc-egress 任务 3.2)。
 *
 * ## 这条测试守的是什么
 *
 * 同一批 env 键有**两个**读者:
 *  - 对话侧 `@blksails/pi-web-adapters` 的 `resolveAiGatewaySessionSpecsFromEnv`
 *  - 图像侧 `@blksails/pi-web-tool-kit` 的 `resolveGatewayImageInstances`
 *
 * 不是重复造轮子,是依赖方向逼出来的:本仓 `core` **依赖** `tool-kit`,故 tool-kit 不能
 * 反向 import adapters(会成环)。
 *
 * 代价是两份解析可能随时间漂移,而漂移的表现极其隐蔽 —— 「同一个账号,聊天能用网关模型,
 * 生图却说没有该模型」。它不会报错,只会少一个实例。本文件是唯一能机械发现它的地方:
 * **同一份 env 输入,断言两侧解出的实例标识 / 基址 / 凭据一致**。
 *
 * ⚠ 若因改解析规则而看到这里报红:不要改断言,去让两侧同步。
 *
 * ★ 基址断言要点:两侧的 `baseUrl` **形态本就不同** —— 对话侧保留 `/v1`(pi SDK 的
 *   `baseURL` 约定),图像侧剥成裸基址(其 provider 占位符自己拼 `/v1`)。所以这里比的是
 *   **归一后**的裸基址,而不是字符串本身。这不是放宽断言:两者若指向不同主机/路径,
 *   归一后仍然不等。
 */
import { describe, it, expect } from "vitest";
import { resolveAiGatewaySessionSpecsFromEnv } from "@blksails/pi-web-adapters/ai-gateway/index.js";
import { resolveGatewayImageInstances } from "@blksails/pi-web-tool-kit";

/** 把任一侧的基址归一为裸形态(剥末尾 `/v1` 与尾斜杠)。 */
function bare(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/v1$/i, "").replace(/\/+$/, "");
}

/** 两侧共用的比较投影。 */
function projectChat(env: NodeJS.ProcessEnv) {
  return resolveAiGatewaySessionSpecsFromEnv(env)
    .map((e) => ({
      instanceId: e.providerName,
      baseUrl: bare(e.spec.baseUrl),
      apiKey: e.spec.apiKey,
    }))
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

function projectImage(env: NodeJS.ProcessEnv) {
  return resolveGatewayImageInstances(env)
    .map((i) => ({
      instanceId: i.instanceId,
      baseUrl: bare(i.baseUrl),
      apiKey: i.apiKey,
    }))
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
}

/** 逐例:同一 env → 两侧投影必须相等。 */
const CASES: ReadonlyArray<{ name: string; env: NodeJS.ProcessEnv }> = [
  {
    name: "零实例",
    env: {},
  },
  {
    name: "存量扁平三件套(缺省实例)",
    env: {
      PI_WEB_AI_GATEWAY_SESSION_BASE: "https://gw.example/v1",
      PI_WEB_AI_GATEWAY_SESSION_KEY: "k-flat",
      PI_WEB_AI_GATEWAY_SESSION_MODELS: JSON.stringify(["gpt-5"]),
    },
  },
  {
    name: "单实例(云端授予形态,标识带连字符)",
    env: {
      PI_WEB_AI_GATEWAY_SESSIONS: "blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE:
        "https://pi-cloud.apps.blksails.cn/api/desktop/egress/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_MODELS: JSON.stringify(["claude-opus-5"]),
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_IMAGE_MODELS: JSON.stringify(["gpt-image-2"]),
    },
  },
  {
    name: "多实例并存(env 网关 + 云端授予)",
    env: {
      PI_WEB_AI_GATEWAY_SESSIONS: "cloudflare,blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_BASE: "https://cf.example/compat/v1",
      PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_KEY: "k-cf",
      PI_WEB_AI_GATEWAY_SESSION_CLOUDFLARE_MODELS: JSON.stringify(["gpt-5"]),
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE: "https://c.example/api/desktop/egress/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_MODELS: JSON.stringify(["claude-opus-5"]),
    },
  },
  {
    name: "某实例凭据缺失 → 两侧都必须跳过它(fail-soft 判据一致)",
    env: {
      PI_WEB_AI_GATEWAY_SESSIONS: "good,broken",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_BASE: "https://good.example/v1",
      PI_WEB_AI_GATEWAY_SESSION_GOOD_KEY: "k-good",
      PI_WEB_AI_GATEWAY_SESSION_BROKEN_BASE: "https://broken.example/v1",
      // BROKEN 无 KEY
    },
  },
  {
    name: "对话清单缺席(冷启)→ 实例仍应存在于两侧",
    env: {
      PI_WEB_AI_GATEWAY_SESSIONS: "blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE: "https://c.example/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
    },
  },
];

describe("契约互锁:对话侧与图像侧解析器读出同一批实例", () => {
  for (const c of CASES) {
    it(`★ ${c.name}`, () => {
      expect(projectImage(c.env)).toEqual(projectChat(c.env));
    });
  }

  it("★ 标识变形规则一致:连字符标识必须在两侧都解得出(而非静默少一个实例)", () => {
    const env: NodeJS.ProcessEnv = {
      PI_WEB_AI_GATEWAY_SESSIONS: "blksails-cloud",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_BASE: "https://c.example/v1",
      PI_WEB_AI_GATEWAY_SESSION_BLKSAILS_CLOUD_KEY: "desk.cred",
    };
    // 先证明这个用例有内容可比 —— 否则「两边都是空数组」也会让上面的相等断言通过。
    expect(projectChat(env)).toHaveLength(1);
    expect(projectImage(env)).toHaveLength(1);
    expect(projectImage(env)[0]?.instanceId).toBe("blksails-cloud");
  });
});

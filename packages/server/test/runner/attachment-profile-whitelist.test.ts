/**
 * runner attachmentProfile 装配期白名单校验单测(agent-attachment-profile spec,任务 3.1;
 * Req 2.1/2.2/5.1)。
 *
 * 覆盖四态:命中(通过)/未命中(含无拓扑,抛错含名字)/未声明(放行)/关断(非法名字也不抛)。
 * 纯函数直测,不拉起完整 startRunner/子进程(与 agent-loader-routes.test.ts 隔离粒度一致)。
 */
import { describe, expect, it } from "vitest";
import { InvalidAgentDefinitionError } from "../../src/runner/agent-loader.js";
import { validateAttachmentProfileWhitelist } from "../../src/runner/runner.js";
import { ATTACHMENT_PROFILE_DISABLED_ENV } from "../../src/runner/attachment-profile-wiring.js";
import { ATTACHMENT_BACKENDS_ENV } from "../../src/attachment/backends-config.js";

const AGENT_PATH = "/tmp/agents/whitelist-agent.ts";

function topologyEnv(...names: string[]): NodeJS.ProcessEnv {
  return {
    [ATTACHMENT_BACKENDS_ENV]: JSON.stringify({
      backends: names.map((name) => ({ kind: "local-fs", name })),
      write: names[0],
    }),
  };
}

describe("validateAttachmentProfileWhitelist — 命中(Req 2.1)", () => {
  it("profile 命中拓扑声明的后端名 → 不抛", () => {
    expect(() =>
      validateAttachmentProfileWhitelist("s3-cn", topologyEnv("local", "s3-cn"), AGENT_PATH),
    ).not.toThrow();
  });
});

describe("validateAttachmentProfileWhitelist — 未命中(含无拓扑,Req 2.2)", () => {
  it("profile 未在拓扑声明集合中 → 抛 InvalidAgentDefinitionError 含 profile 名", () => {
    const error = (() => {
      try {
        validateAttachmentProfileWhitelist("ghost", topologyEnv("local"), AGENT_PATH);
        return undefined;
      } catch (e) {
        return e;
      }
    })();
    expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
    expect((error as Error).message).toContain("ghost");
    expect((error as Error).message).toContain("local");
  });

  it("宿主未声明任何拓扑(parseBackendsEnv 返回 undefined)→ 任意 profile 必失败", () => {
    expect(() => validateAttachmentProfileWhitelist("anything", {}, AGENT_PATH)).toThrow(
      InvalidAgentDefinitionError,
    );
  });
});

describe("validateAttachmentProfileWhitelist — 未声明(Req 1.2)", () => {
  it("profile 为 undefined → 放行(不校验,existing agents 零行为变化)", () => {
    expect(() => validateAttachmentProfileWhitelist(undefined, {}, AGENT_PATH)).not.toThrow();
    expect(() =>
      validateAttachmentProfileWhitelist(undefined, topologyEnv("local"), AGENT_PATH),
    ).not.toThrow();
  });
});

describe("validateAttachmentProfileWhitelist — 关断(Req 5.1)", () => {
  it("关断生效时,即便 profile 未注册也不抛(忽略声明)", () => {
    const env = { ...topologyEnv("local"), [ATTACHMENT_PROFILE_DISABLED_ENV]: "1" };
    expect(() => validateAttachmentProfileWhitelist("ghost-profile", env, AGENT_PATH)).not.toThrow();
  });

  it("关断生效 + 宿主未声明拓扑,非法名字也不抛", () => {
    const env = { [ATTACHMENT_PROFILE_DISABLED_ENV]: "1" };
    expect(() => validateAttachmentProfileWhitelist("anything", env, AGENT_PATH)).not.toThrow();
  });
});

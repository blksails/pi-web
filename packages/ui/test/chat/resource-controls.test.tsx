import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PromptTemplateCards, SkillPill } from "../../src/chat/resource-controls.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const config = { endpoint: "/api", agentId: "agent-1" } as const;

describe("chat resource controls", () => {
  it("技能 pill 只有一个入口，并可打开个人技能管理弹窗", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          skills: [{ kind: "skill", scope: "personal", name: "review", title: "代码审查", description: "审查" }],
          templates: [],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<SkillPill config={config} value="" onInsert={() => undefined} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/resources?agent=agent-1",
      { credentials: "include" },
    ));
    expect(screen.getAllByRole("button", { name: "技能" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "技能" }));
    expect(screen.getByRole("menuitem", { name: /代码审查/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "管理技能" }));
    expect(screen.getByRole("dialog", { name: "管理个人技能" })).toBeTruthy();
  });

  it("模板卡片展示源标题/封面并把正文带回输入框", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith("/api/resources/templates/")) {
        return Promise.resolve(
          new Response(JSON.stringify({ resource: {
            kind: "template",
            scope: "agent",
            name: "shot",
            description: "分镜模板",
            sourceTitle: "电影分镜",
            coverImage: "https://example.com/cover.png",
            content: "请生成镜头：$ARGUMENTS",
          } }), { status: 200 }),
        );
      }
      return Promise.resolve(
        new Response(JSON.stringify({ skills: [], templates: [{
          kind: "template",
          scope: "agent",
          name: "shot",
          description: "分镜模板",
          sourceTitle: "电影分镜",
          coverImage: "https://example.com/cover.png",
        }] }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSelect = vi.fn();
    render(<PromptTemplateCards config={config} onSelect={onSelect} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /电影分镜/ })).toBeTruthy());
    expect(screen.getByAltText("")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /电影分镜/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("请生成镜头：$ARGUMENTS"));
  });
});

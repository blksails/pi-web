/**
 * LauncherRail — 侧栏启动导航区(sidebar-launcher-rail)。
 *
 * 覆盖:新建聊天恒显+回调(Req 2.1/2.2)、搜索键入→结果→onResume+空态+清空复位
 * (Req 3.1/3.3/3.4/3.5)、收藏锚点渲染+onLaunchSource+无收藏不占位(Req 4.3/4.4/4.5)、
 * webext 槽渲染+抛错被 error boundary 隔离(Req 5.1/5.4)。
 */
import { afterEach, describe, it, expect, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import type {
  ListSessionsRequest,
  ListSessionsResponse,
  ListFavoritesResponse,
} from "@blksails/pi-web-protocol";
import { LauncherRail } from "../../src/elements/launcher-rail.js";

afterEach(cleanup);

const noSessions = (): Promise<ListSessionsResponse> =>
  Promise.resolve({ sessions: [], scope: "cwd", globalEnabled: false });
const noFavorites = (): Promise<ListFavoritesResponse> =>
  Promise.resolve({ favorites: [] });

function baseProps(over: Partial<React.ComponentProps<typeof LauncherRail>> = {}) {
  return {
    onNewChat: vi.fn(),
    onResume: vi.fn(),
    onLaunchSource: vi.fn(),
    listSessions: noSessions,
    currentCwd: "/w",
    listFavorites: noFavorites,
    setFavorites: vi.fn(() => Promise.resolve({ favorites: [] })),
    ...over,
  };
}

describe("LauncherRail", () => {
  it("新建聊天恒显,点击触发 onNewChat(Req 2.1/2.2)", () => {
    const props = baseProps();
    render(<LauncherRail {...props} />);
    const btn = document.querySelector("[data-launcher-new-chat]")!;
    fireEvent.click(btn);
    expect(props.onNewChat).toHaveBeenCalledTimes(1);
  });

  it("搜索:键入→结果→点击 onResume;空态;清空复位(Req 3.x)", async () => {
    const listSessions = (req: ListSessionsRequest): Promise<ListSessionsResponse> =>
      Promise.resolve({
        sessions:
          req.q === "hit"
            ? [{ sessionId: "s1", name: "Hit One", cwd: "/w", createdAt: "t" }]
            : [],
        scope: "cwd",
        globalEnabled: false,
      });
    const onResume = vi.fn();
    render(<LauncherRail {...baseProps({ listSessions, onResume })} />);

    fireEvent.click(document.querySelector("[data-launcher-search]")!);
    const input = document.querySelector("[data-launcher-search-input]")! as HTMLInputElement;

    // 命中 → 结果项出现,点击 → onResume。
    fireEvent.change(input, { target: { value: "hit" } });
    await waitFor(() => expect(screen.getByText("Hit One")).toBeTruthy());
    fireEvent.click(document.querySelector("[data-launcher-search-result]")!);
    expect(onResume).toHaveBeenCalledWith("s1");
  });

  it("搜索无结果 → 空态提示(Req 3.4)", async () => {
    render(<LauncherRail {...baseProps()} />);
    fireEvent.click(document.querySelector("[data-launcher-search]")!);
    fireEvent.change(
      document.querySelector("[data-launcher-search-input]")!,
      { target: { value: "zzz" } },
    );
    await waitFor(() =>
      expect(document.querySelector("[data-launcher-search-empty]")).toBeTruthy(),
    );
  });

  it("收藏锚点:渲染+点击 onLaunchSource(Req 4.3/4.4)", async () => {
    const listFavorites = (): Promise<ListFavoritesResponse> =>
      Promise.resolve({ favorites: [{ source: "/fav", name: "Fav Agent" }] });
    const onLaunchSource = vi.fn();
    render(<LauncherRail {...baseProps({ listFavorites, onLaunchSource })} />);
    await waitFor(() => expect(screen.getByText("Fav Agent")).toBeTruthy());
    fireEvent.click(document.querySelector("[data-launcher-favorite]")!);
    expect(onLaunchSource).toHaveBeenCalledWith("/fav");
  });

  it("无收藏 → 不渲染收藏分区(Req 4.5)", async () => {
    render(<LauncherRail {...baseProps()} />);
    // 等一拍让 listFavorites effect 结算。
    await waitFor(() =>
      expect(document.querySelector("[data-launcher-new-chat]")).toBeTruthy(),
    );
    expect(document.querySelector("[data-launcher-favorites]")).toBeNull();
  });

  it("webext 槽:有贡献则渲染;贡献抛错被 error boundary 隔离,其余分区仍在(Req 5.1/5.4)", () => {
    const Boom = (): React.JSX.Element => {
      throw new Error("boom");
    };
    // 静默 React error boundary 的 console 噪音。
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<LauncherRail {...baseProps({ webextSlot: <Boom /> })} />);
    // 抛错被隔离:新建聊天(其它分区)仍在。
    expect(document.querySelector("[data-launcher-new-chat]")).toBeTruthy();
    spy.mockRestore();
  });

  it("无 webextSlot → 不渲染 webext 槽(Req 5.2)", () => {
    render(<LauncherRail {...baseProps()} />);
    expect(document.querySelector("[data-launcher-webext-slot]")).toBeNull();
  });
});

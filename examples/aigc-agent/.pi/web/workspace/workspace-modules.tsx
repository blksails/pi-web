// [迁移壳层] 源:aigc-agent components/workspace-modules.tsx。由 scripts/sync-from-aigc-agent.mjs 覆盖,勿手改。
"use client";

import * as React from "react";
import { Image as ImageIcon, Palette, Search, SquareDashed } from "lucide-react";
import { uploadAttachment } from "@blksails/pi-web-react";
import { CanvasWorkspace } from "../canvas-panel.js";
import {
  getWorkspaceModule,
  registerWorkspaceModule,
} from "./lib/module-registry.js";
import { MaterialDrawer } from "./material-drawer.js";
import { SearchPanel } from "./search-panel.js";
import { SandboxModuleFrame } from "./sandbox-module-frame.js";

/**
 * 内置工作区模块的注册（import 本文件即注册）。
 *
 * 新增模块只需在此追加一条 `registerWorkspaceModule`——右栏 Tab 条与左栏「添加模块」
 * 菜单自动长出，外壳零改动。设计见
 * `docs/superpowers/specs/2026-07-20-workspace-module-shell-design.md`。
 *
 * 幂等守卫：dev HMR 会重新执行本模块，而 `registerWorkspaceModule` 对重复 id 抛错
 * （那是给「两处代码争夺同一 Tab」用的契约），故此处先查后注。
 */

if (getWorkspaceModule("canvas") === undefined) {
  registerWorkspaceModule({
    id: "canvas",
    title: "画布",
    description: "AIGC 画廊与二创工作台",
    icon: Palette,
    openByDefault: true,
    render: (ctx) => (
      <CanvasWorkspace
        surface={ctx.surface}
        galleryState={ctx.galleryState}
        upload={uploadAttachment}
        baseUrl={ctx.baseUrl}
        {...(ctx.sessionId !== undefined ? { sessionId: ctx.sessionId } : {})}
        {...(ctx.conversation !== undefined
          ? { conversation: ctx.conversation }
          : {})}
        onHide={ctx.closeSelf}
      />
    ),
  });
}

if (getWorkspaceModule("materials") === undefined) {
  registerWorkspaceModule({
    id: "materials",
    title: "素材",
    description: "本会话素材库与全局素材目录",
    icon: ImageIcon,
    openByDefault: true,
    // 不传 drawer/onGripDown/onToggleFull ⇒ MaterialDrawer 走「工作区模块形态」：
    // 占满所在窗，隐去抓手与「占满/还原」，右上角按钮 = 关闭本模块。
    render: (ctx) => (
      <MaterialDrawer
        connection={undefined}
        sessionId={ctx.sessionId}
        galleryState={ctx.galleryState}
        onToggleHide={ctx.closeSelf}
      />
    ),
  });
}

if (getWorkspaceModule("search") === undefined) {
  registerWorkspaceModule({
    id: "search",
    title: "搜图",
    description: "以词搜图：语义检索历史生成素材",
    icon: Search,
    // Search-to-Tab：由左栏搜索按钮 / Cmd+K 浮层按需打开，不默认占位。
    render: () => <SearchPanel />,
  });
}

if (getWorkspaceModule("sandbox") === undefined) {
  registerWorkspaceModule({
    id: "sandbox",
    title: "沙箱",
    description:
      "不透明 origin 沙箱页（allow-scripts，无宿主 DOM/凭证）+ MessagePort 私有通道",
    icon: SquareDashed,
    render: (ctx) => (
      <SandboxModuleFrame
        src="/sandbox/preview.html"
        instanceId={`sandbox:${ctx.sessionId ?? "anon"}`}
        title="沙箱预览"
        // 后台静音名单：被隐藏的面板不得抢占导航/打开模块/弹模态
        // （Luigi `skipEventsWhenInactive` 范式，来源 02 §5.4）。
        privilegedEvents={["navigate", "openModule", "alert"]}
      />
    ),
  });
}

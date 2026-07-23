/**
 * 五个 pane 的元信息——**单一事实源**(web-safe,仅类型依赖):
 *  - web 侧(web/panes/index.ts)展开成完整定义(注入 document/lifecycle);
 *  - agent 侧(panes-modules.ts)作 PaneAgentModule 身份与 route 覆盖校验。
 * 标题/配额/capabilities 改这里,两侧同步,不再人肉对齐。
 */
import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit/contract";

export type PaneMeta = Omit<PaneDefinitionInput, "document" | "lifecycle">;

const panesSurface = {
  surfaceKeys: ["surface:panes"],
  surfaceCommands: [],
  attachments: "none",
  conversation: "none",
} satisfies PaneMeta["capabilities"];

export const filesPaneMeta: PaneMeta = {
  id: "files",
  title: "文件",
  icon: "▤",
  allowMultiple: true,
  maxInstances: 3,
  capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET", "POST"] }] },
};

export const editorPaneMeta: PaneMeta = {
  id: "editor",
  title: "编辑",
  icon: "⌘",
  allowMultiple: true,
  maxInstances: 4,
  capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET", "POST"] }] },
};

export const diffPaneMeta: PaneMeta = {
  id: "diff",
  title: "Diff",
  icon: "±",
  allowMultiple: true,
  maxInstances: 3,
  capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET"] }] },
};

export const canvasPaneMeta: PaneMeta = {
  id: "canvas",
  title: "Canvas",
  icon: "◇",
  allowMultiple: true,
  maxInstances: 3,
  capabilities: {
    routes: [],
    surfaceKeys: ["surface:canvas"],
    surfaceCommands: [{ domain: "canvas", actions: ["sync", "register", "edit", "inpaint", "reference", "variants", "outpaint", "reframe", "delete"] }],
    attachments: "read-write",
    conversation: "submit",
  },
};

export const artifactPaneMeta: PaneMeta = {
  id: "artifact",
  title: "Artifact",
  icon: "◫",
  allowMultiple: true,
  maxInstances: 3,
  capabilities: { ...panesSurface, routes: [{ name: "pane-data", methods: ["GET", "POST"] }] },
};

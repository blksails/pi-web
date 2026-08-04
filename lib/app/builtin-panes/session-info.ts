/**
 * `host:session-info` 的宿主侧 pane 定义(spec host-builtin-panes,任务 3.2)。
 *
 * guest 实现在 `panes/session-info/`,其文档由 `scripts/build-builtin-panes.ts` 打成内联
 * srcDoc。本文件只把「标识 + 标题 + 文档 + 授权」绑成一份 pane 定义。
 */
import { HOST_PANE_ID_PREFIX } from "@blksails/pi-web-panes-kit";
import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit/contract";
import { builtinPaneDocuments } from "../../../panes/generated.js";

/** guest 目录名 → 产物键。 */
const DOCUMENT_KEY = "session-info";

export const SESSION_INFO_PANE_ID = `${HOST_PANE_ID_PREFIX}${DOCUMENT_KEY}`;

/**
 * 构造 pane 定义;**构建产物缺席时返回 undefined**。
 *
 * 为什么是降级而不是抛错:产物是 gitignore 的构建输出,一次没跑构建不该让整个会话外壳崩。
 * 缺席时该 pane 不进清单 → 清单可能变空 → 装载判据落到「面板整体不渲染」(Req 1.7),
 * 也就是回到本特性实施前的外观。这条「门控落能力内部、不落清单」的纪律见任务 3.2 说明。
 */
export function sessionInfoPane(): PaneDefinitionInput | undefined {
  const srcDoc = builtinPaneDocuments[DOCUMENT_KEY];
  if (typeof srcDoc !== "string" || srcDoc.length === 0) return undefined;
  return {
    id: SESSION_INFO_PANE_ID,
    title: "会话信息",
    document: { kind: "html", src: `/pane-${DOCUMENT_KEY}.html` },
    // ★ 全空:它什么授权都不需要。这同时是「内置身份不产生额外权限」的活体证据 ——
    // 一个零授权的内置 pane 确实什么都调不动(Req 4.x)。
    capabilities: {},
    allowMultiple: false,
    maxInstances: 1,
    lifecycle: { keepAlive: true, suspendWhenHidden: false },
  };
}

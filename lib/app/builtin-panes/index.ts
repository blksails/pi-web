/**
 * 宿主内置 pane 的单一权威清单(spec host-builtin-panes,任务 3.2)。
 *
 * **新增一个内置 pane = 建一个 `panes/<id>/` 目录 + 在本文件的清单里加一行。**
 * 这条纪律镜像内置扩展清单(`BUILTIN_EXTENSIONS`)的「只改一处」:清单散开的后果是新增时漏改
 * 某处,而漏改的表现往往是静默不生效。
 *
 * ## 清单里不做条件过滤
 *
 * 门控若将来需要(某形态下某 pane 不可用),应落**各 pane 定义内部** —— 由它自己在能力不可用
 * 时返回 undefined 或渲染降级态。清单按条件过滤会重新引入「某形态下静默缺失」这一类缺陷
 * (`runner-self-resolved-builtins` 记录过同类前科:门控落在清单外,导致某形态下能力静默不可用)。
 */
import {
  HOST_PANE_ID_PREFIX,
  type PaneSource,
} from "@blksails/pi-web-panes-kit";
import type { PaneDefinitionInput } from "@blksails/pi-web-panes-kit/contract";
import { browserPane } from "./browser.js";
import { sessionInfoPane } from "./session-info.js";

export {
  IDENTITY_REVISION_SIGNAL_NAME,
  SESSION_SIGNAL_NAME,
  buildSessionSignals,
} from "./session-signal.js";
export type { SessionSignalFacts, SessionSignalInput } from "./session-signal.js";
export { SESSION_INFO_PANE_ID } from "./session-info.js";
export { BROWSER_PANE_ID } from "./browser.js";

/**
 * 内置 pane 的构造器清单。
 *
 * 用构造器而非现成对象:每个 pane 都可能因为自身前提不满足(如构建产物缺席)而不可用,
 * 返回 undefined 即自行退出清单。
 */
const BUILTIN_PANE_FACTORIES: ReadonlyArray<() => PaneDefinitionInput | undefined> = [
  sessionInfoPane,
  browserPane,
];

/** 当前可用的内置 pane 定义(已剔除自身前提不满足者)。 */
export function builtinPanes(): readonly PaneDefinitionInput[] {
  const panes: PaneDefinitionInput[] = [];
  for (const factory of BUILTIN_PANE_FACTORIES) {
    const pane = factory();
    if (pane !== undefined) panes.push(pane);
  }
  return panes;
}

/**
 * 组装为一个可参与合并的 pane 来源;**无可用内置 pane 时返回 undefined**。
 *
 * 返回 undefined 而非空来源:空来源会被合并函数记成一条 `invalid-definition` 拒绝
 * (`panes` 至少要一项),那是噪音 —— 「宿主本来就没有内置 pane」不是错误,而是让装载判据
 * 落到「面板整体不渲染」的正常路径(Req 1.7)。
 */
export function builtinPaneSource(): PaneSource | undefined {
  const panes = builtinPanes();
  if (panes.length === 0) return undefined;
  return {
    kind: "builtin",
    origin: "builtin",
    definition: {
      id: "host-builtin",
      panes: [...panes],
      // 内置 pane 默认不抢占初始打开位:agent 的会话形态优先。
      // 无 agent 贡献时 definePanes 会自动以第一个 pane 作初始项,故用户仍能看到内容。
      maxOpenPanes: 16,
    },
  };
}

/** 供守卫测试使用:内置标识必须带保留前缀,否则合并期会被拒。 */
export const BUILTIN_PANE_ID_PREFIX = HOST_PANE_ID_PREFIX;

/**
 * panes-manifest — pane 静态清单的组装与形态校验(spec cli-agent-build,任务 3.6,
 * Req 2.3, 3.5;design.md「Components and Interfaces」/「Data Models / panes.json sidecar」)。
 *
 * `pi-web build` 的第五阶段(design.md「System Flows」流程步 8):把 {@link PaneDiscovery}
 * 收敛成一份描述全部 pane 能力与面板配置的静态清单({@link PanesSidecar}),使宿主无需加载
 * 扩展代码即可发现 pane 能力(2.3)。
 *
 * ## 为什么必须经 `definePanes` 校验,不自建校验(3.5)
 *
 * `pane-discovery.ts` 只做浅层结构检查(`capabilities` 是否为对象),不深入其内部字段——
 * 深层校验(如 `capabilities.routes` 是否真的是数组、`attachments` 枚举值是否合法)是
 * `@blksails/pi-web-panes-kit` 的 `PaneCapabilitiesSchema` 的职责,不在此处重新实现
 * (design.md「Allowed Dependencies」:`definePanes` 是结构校验唯一来源)。
 *
 * 这正是本 spec 起因的那类漂移要在构建期提前暴露的核心手段:旧宿主曾把
 * `ext.panes = { definition: {...}, config: {...} }` 这类两层包装的畸形结构一路带到运行期,
 * 才在宿主消费侧炸成「界面崩溃」。若某个字段(如 `capabilities.routes`)在声明侧被误包成
 * `{ definition: [...], config: {} }` 这种嵌套对象而非期望的数组,`definePanes` 会在**构建期**
 * 拒绝它——不必等到运行期才发现。
 *
 * `document` 字段是 `PaneDefinitionSchema` 的必填项,但构建期独占字段(`entry`/`canvasStyles`)
 * 与运行期字段(`document`/`lifecycle`/`allowMultiple`/`hostView`)互不重叠(research.md F10)——
 * sidecar 本身不携带 `document`(它由 `pane-build.ts` 产出,写入内联/URL 双形态产物,不进
 * `panes.json`)。因此这里为满足 schema 合成一个占位 `document`,只为借道 `definePanes` 校验
 * `capabilities`/`id`/`title` 等其余字段与 `initialPaneIds`/`maxOpenPanes` 的一致性,占位值本身
 * 不进入 sidecar 输出。
 */
import { definePanes, type PaneCapabilities, type PanesDefinitionInput } from "@blksails/pi-web-panes-kit/contract";
import type { PaneDiscovery } from "./pane-discovery.js";
import { BuildError } from "./errors.js";

/** 满足 `PaneDefinitionSchema.document` 必填约束的占位值——不进入 sidecar 输出,见文件头注释。 */
const PLACEHOLDER_DOCUMENT = { kind: "inline", srcDoc: "" } as const;

/** `panes.json` sidecar 中单个 pane 的条目(design.md「Data Models」)。 */
export interface PaneSidecarEntry {
  readonly id: string;
  readonly title: string;
  readonly icon?: string;
  readonly capabilities: PaneCapabilities;
}

/** `panes.json` sidecar 的整体形态(design.md「Data Models」)。 */
export interface PanesSidecar {
  readonly id: string;
  /** 面板配置(`panelConfig`)与 pane 集合配置(`panesConfig`)的合并结果。 */
  readonly config: Readonly<Record<string, unknown>>;
  /** 按 `id` 排序,使产物字节可复现(design.md「不变量」)。 */
  readonly panes: readonly PaneSidecarEntry[];
}

/**
 * 组装 pane 静态清单并经 `definePanes` 走一遍完整结构校验(design.md 流程步 8)。
 *
 * @param discovery `discoverPaneModules` 的产出(非 `undefined`——调用方在无 pane 声明时
 *   不应调用本函数,3.3 的「空集不失败」分支在 `pane-discovery` 层面已处理)。
 * @throws {BuildError} `stage:"manifest"`——`definePanes` 校验失败时,携带 `discovery.origin`
 *   作为出问题的声明位置(3.5,复用「声明不合法」的定位纪律)。
 */
export function assemblePanesManifest(discovery: PaneDiscovery): PanesSidecar {
  const sortedModules = [...discovery.modules].sort((a, b) => a.id.localeCompare(b.id));

  const definitionInput: PanesDefinitionInput = {
    id: discovery.panesId,
    panes: sortedModules.map((module) => ({
      id: module.id,
      title: module.title,
      ...(module.icon !== undefined ? { icon: module.icon } : {}),
      document: PLACEHOLDER_DOCUMENT,
      capabilities: module.capabilities,
    })),
    ...(discovery.panelConfig.initialPaneIds !== undefined
      ? { initialPaneIds: discovery.panelConfig.initialPaneIds as PanesDefinitionInput["initialPaneIds"] }
      : {}),
    ...(discovery.panelConfig.maxOpenPanes !== undefined
      ? { maxOpenPanes: discovery.panelConfig.maxOpenPanes as PanesDefinitionInput["maxOpenPanes"] }
      : {}),
  };

  let validated;
  try {
    validated = definePanes(definitionInput);
  } catch (error) {
    throw new BuildError({
      stage: "manifest",
      code: "BUILD_MANIFEST_INVALID_SHAPE",
      detail: `pane 声明未通过结构校验:${error instanceof Error ? error.message : String(error)}`,
      path: discovery.origin,
    });
  }

  const validatedById = new Map(validated.panes.map((pane) => [pane.id, pane]));

  const panes: PaneSidecarEntry[] = sortedModules.map((module) => {
    // 校验后的形态是唯一权威来源(归一化默认值、去除占位 document 后的真实字段)。
    const pane = validatedById.get(module.id)!;
    return {
      id: pane.id,
      title: pane.title,
      ...(pane.icon !== undefined ? { icon: pane.icon } : {}),
      capabilities: pane.capabilities,
    };
  });

  return {
    id: discovery.panesId,
    config: { ...discovery.panelConfig, ...discovery.panesConfig },
    panes,
  };
}

/**
 * model-catalog · ModelCatalogService — chat/image 双命名空间目录组装与过滤的
 * **单一权威**(model-catalog spec design.md「ModelCatalogService」组件块,
 * multi-gateway-providers spec design.md「core / ModelCatalogService(重构)」组件块,
 * Req 1.1–1.4, 3.1, 3.3, 3.5, 4.1, 4.3–4.5, 5.1–5.4, 10.1)。
 *
 * 定位与不变式:
 * - **组装,不取数**:各来源(self 对话取数、网关快照、图像静态目录、隐藏名单)
 *   全部经构造注入;自身零 env 读取、零 IO(纯依赖注入,便于单测)。
 * - **隐藏名单 = 彻底禁用,对全部类型一致生效**(multi-gateway-providers 任务 4.4,
 *   Req 5.1–5.4):`hidden`(`PI_WEB_HIDE_PROVIDERS`)对 chat 与 image 两个命名空间
 *   同等生效 —— `imageEntries()` 与 `chatOptions()` 均无条件过滤;`query()` 的
 *   `applyHidden` 同时控制两侧(缺省 `true`,`false` 时两侧均不过滤)。
 *   ★ 任务 4.1 曾把「image 侧不吃 hidden」写为刻意留白(理由:避免与彻底禁用的验收
 *   产生重叠、无法单独复核),该留白已由本任务(4.4)兑现 —— 不再有「工具能跑但清单
 *   不可见」这种偏差(旧行为见 git 历史,不再是当前契约)。
 * - **零侵入**:gateway 来源未注入(= 未启用 ai-gateway 套件)且 hidden 为空集时,
 *   chat 输出对 `listSelfChat()` 结果、image 输出对注入的静态目录均为引用级透传
 *   (字节一致,Req 1.3/4.3/10.1);hidden 非空时才产生新对象,不影响零侵入基线。
 * - fail-soft:网关快照的既有 fail-soft 语义(拉取失败/从未成功 → 空集)原样透传,
 *   空集时行为 = merge 空数组,不阻断、不报错(Req 1.4)。
 *
 * `query()`(multi-gateway-providers 任务 4.1,Req 3.1, 3.3, 3.5, 4.4, 4.5, 10.1)是
 * `chatOptions()` + `imageEntries()` 收敛后的**单一带筛选查询**:合并 chat 与 image
 * 两个命名空间的全部条目,投影为统一字段命名的 `CatalogModel`(`provider`/`id`/`name`/
 * `input`/`output`/`source`),按 `input`/`output` 类型筛选(Req 4.4/4.5)。
 * `chatOptions()`/`imageEntries()` 两个旧方法**保留为兼容外壳**(内部改为共用 `query()`
 * 同一份组装逻辑):`lib/app/pi-handler.ts` 等消费方的迁移属任务 4.3(端点合一),
 * 不在本任务边界内,故暂不摘除旧方法签名,避免越界改动未列入本任务目标文件的调用点。
 *
 * ★ `toImageCatalogModel` 读取图像条目**自身**声明的 `input`/`output`(经宽松类型断言
 * 防御性读取,`AigcCatalogEntry` 本身尚未声明这两个字段——那是任务 4.2 的范围),而非
 * 写死 `output: ["image"]`;未声明时才落到图像命名空间的缺省值。写死会让
 * `query({ input: "image" })`(Req 4.5,顶替旧视觉模型清单的查询)对全部 AIGC 条目恒
 * 返回空 `input`,该端点直接失效——这是本任务被打回过一次的真实缺陷,须由单测覆盖
 * 「条目声明覆盖缺省值」这一点,不能只测缺省路径。
 *
 * 消费方:lib/app/pi-handler 装配处构造一次,`GET /api/config/models` 与
 * `GET /api/aigc/models` 均改经本服务取数(task 3.1)。
 *
 * `customProviders`(multi-gateway-providers 任务 5.3,Req 7.2, 7.5):自定义 provider
 * 作为第三类来源并入 `query()`(chat/image 之外)。经 `ProviderRegistry` 注入 ——
 * `.providers()` 已按 `enabled` 过滤(停用即从目录消失),`.find()` 不受过滤影响
 * (配置仍在,供再次启用)。装配处见 `packages/core/src/model-catalog/
 * custom-provider-source.ts` 的 `createCustomProviderSource`。
 */
import type { AigcCatalogEntry } from "@blksails/pi-web-tool-kit";
import { excludeProviderModels, excludeProviders } from "../config/model-options-filter.js";
import type { ModelOption, ModelOptions } from "../config/model-options.types.js";
import { matchesFilter, normalizeModalities, type Modality } from "./modality.js";
import { normalizeLegacyProviderId } from "./provider-identity.js";
import type { CustomProviderModel } from "./custom-provider-source.js";
import type { ProviderRegistry } from "./provider-source.js";
import type { GatewayModelEntry, MergeModelCatalog, ModelPrecedence } from "./types.js";

/** `createModelCatalogService` 的注入依赖(装配期一次性构造)。 */
export interface ModelCatalogServiceDeps {
  /** self 对话目录取数(既有 listModelOptions 闭包,hidden 过滤前的原始集)。 */
  readonly listSelfChat: () => ModelOptions;
  /** 网关对话目录快照;未启用 ai-gateway 时不注入(注入与否即启用判别)。 */
  readonly gatewayChat?: { get(): readonly GatewayModelEntry[] };
  /** 同名排序偏好(merge 的块排序,不做覆盖删除;缺省 `"gateway"`)。 */
  readonly modelPrecedence?: ModelPrecedence;
  /**
   * self 与网关目录的合并能力,由装配层注入(spec: core-package-extraction,任务 3.1)。
   *
   * ★ 与 `gatewayChat` **同进同出**:注入了网关目录就必须一并注入本项。缺失时
   *   `chatOptions()` 会**立即抛错**,而不是悄悄退回「网关未启用」的形态 ——
   *   静默降级的表现是「网关模型从列表里凭空消失」,那种症状极难归因到装配点漏传。
   */
  readonly mergeCatalog?: MergeModelCatalog;
  /** 图像静态目录(self)。 */
  readonly imageCatalog: readonly AigcCatalogEntry[];
  /** 网关图像静态目录;未启用时不注入。 */
  readonly gatewayImageCatalog?: readonly AigcCatalogEntry[];
  /**
   * Cloudflare AI Gateway 图像静态目录(spec cloudflare-aigc-provider,Req 4.2);
   * 未启用(三个 `CLOUDFLARE_*` env 未齐备)时不注入。
   */
  readonly cloudflareImageCatalog?: readonly AigcCatalogEntry[];
  /**
   * 隐藏 provider 集合(multi-gateway-providers 任务 4.4,Req 5.1–5.4):对 chat 与
   * image 两个命名空间**一致生效** —— 彻底禁用,不因用途不同而例外。
   */
  readonly hiddenProviders: ReadonlySet<string>;
  /**
   * 自定义 provider 来源(multi-gateway-providers 任务 5.3,design.md
   * `CustomProviderSource`;Req 7.2, 7.5):由装配层读取 providers 配置域、组装为
   * `ProviderRegistry` 后注入。`providers()` 已按 `enabled` 过滤 —— 停用的 provider
   * 在 `query()` 结果中不再出现,但其定义仍留在注册表里(`find()` 可查),配置本身
   * 不因停用而丢失(Req 7.5「保留其配置以便再次启用」)。未注入 = 未启用任何自定义
   * provider,`query()` 的输出与该来源不存在时一致(零侵入,Req 10.1 的自然延伸)。
   */
  readonly customProviders?: ProviderRegistry<CustomProviderModel>;
}

/** 图像目录输出条目:静态条目 + 可选来源标记(仅聚合形态附带,响应只增不改)。 */
export type CatalogImageEntry = AigcCatalogEntry & {
  readonly source?: "self" | "ai-gateway" | "cloudflare";
};

/**
 * `query()` 的筛选参数(multi-gateway-providers 任务 4.1,design.md「core /
 * ModelCatalogService(重构)」组件块;Req 3.4, 4.4, 4.5)。
 */
export interface CatalogQuery {
  /** 按输入类型筛选(如 `"image"` = 可读图模型,Req 4.5)。未指定 = 不按输入筛选。 */
  readonly input?: Modality;
  /** 按输出类型筛选(如 `"image"` = 生图模型,Req 4.4)。未指定 = 不按输出筛选。 */
  readonly output?: Modality;
  /**
   * 是否应用隐藏名单。缺省 `true`(Req 5.1「隐藏名单彻底禁用」)。任务 4.4:
   * 同时控制 chat 与 image 两侧 —— 取 `false` 时两侧均不过滤,不再有单独只控
   * chat 侧的旧语义。
   */
  readonly applyHidden?: boolean;
}

/**
 * 目录统一投影后的单条模型(multi-gateway-providers 任务 4.1,design.md「core /
 * ModelCatalogService(重构)」组件块;Req 3.3, 3.5):字段命名不再因 chat/image
 * 用途而异 —— image 侧 `model`→`id`、`label`→`name`,统一到与 chat 侧同形态。
 */
export interface CatalogModel {
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  /** 输入类型集合(Req 4.1),经 `normalizeModalities` 归一,缺省已补齐。 */
  readonly input: readonly Modality[];
  /** 输出类型集合(Req 4.1),经 `normalizeModalities` 归一,缺省已补齐。 */
  readonly output: readonly Modality[];
  /** 来源标记(Req 3.5):标明条目出自本地配置、哪个网关,还是云端下发。 */
  readonly source: string;
  /** 网关上游渠道名,仅供展示,不参与筛选或去重。 */
  readonly channel?: string;
  readonly availability?: "session" | "catalog";
}

/** `query()` 的返回形态:去重后的 provider 名(取自筛选后的 `models`)+ 统一模型清单。 */
export interface CatalogQueryResult {
  readonly providers: readonly string[];
  readonly models: readonly CatalogModel[];
}

/** chat/image 双命名空间目录的组装与过滤单一权威。 */
export interface ModelCatalogService {
  /** GET /config/models 数据:providers=self-only(过滤后),models=self∪gateway(过滤后)。 */
  chatOptions(): ModelOptions;
  /**
   * GET /aigc/models 数据:静态∪网关条目(带 source),经 hidden 过滤(任务 4.4,
   * Req 5.1–5.4:隐藏名单彻底禁用,image 侧不再例外)。
   */
  imageEntries(): readonly CatalogImageEntry[];
  /**
   * 单一带筛选的统一查询(Req 3.1, 3.3, 3.4, 3.5, 4.4, 4.5, 10.1):合并 chat 与
   * image 两个命名空间的全部条目,按 `input`/`output` 类型筛选,`applyHidden`
   * (缺省 `true`)同时控制两侧的隐藏名单过滤(任务 4.4,Req 5.1)。
   */
  query(q?: CatalogQuery): CatalogQueryResult;
}

/** chat 条目(`ModelOption`)→ 统一投影(Req 3.3):source 缺省落到 `"self"`。 */
function toChatCatalogModel(m: ModelOption): CatalogModel {
  const { input, output } = normalizeModalities({ input: m.input, output: m.output });
  return {
    provider: m.provider,
    id: m.id,
    name: m.name,
    input,
    output,
    source: m.source ?? "self",
    channel: m.channel,
    availability: m.availability,
  };
}

/**
 * image 命名空间未声明 input/output 时的缺省(design.md 数据模型表「AIGC 静态目录」行):
 * 图像目录里的条目多数身兼「文生图」与「图生图/编辑」,故 input 缺省同时含 text 与
 * image,而非空集;output 恒含 image(这是它们进入图像目录的理由)。
 */
const DEFAULT_IMAGE_INPUT: readonly string[] = ["text", "image"];
const DEFAULT_IMAGE_OUTPUT: readonly string[] = ["image"];

/**
 * image 条目(`CatalogImageEntry`)→ 统一投影(Req 3.3, 4.5)。
 *
 * ★ 经宽松类型断言**读取条目自身**声明的 `input`/`output`(`AigcCatalogEntry` 当前
 * 尚未在类型层声明这两个字段——那是任务 4.2 的范围,本函数对其做前向兼容:一旦
 * 4.2 把字段补上,本函数无需再改就能生效)。缺省值只在条目**未声明**时才落用,
 * 不是无条件写死 —— 否则 `query({ input: "image" })` 会对全部 AIGC 条目恒返回
 * 空 `input`,该查询即无法顶替旧视觉模型清单(Req 4.5)。
 */
function toImageCatalogModel(e: CatalogImageEntry): CatalogModel {
  const declared = e as CatalogImageEntry & {
    readonly input?: readonly string[];
    readonly output?: readonly string[];
  };
  const { input, output } = normalizeModalities({
    input: declared.input ?? DEFAULT_IMAGE_INPUT,
    output: declared.output ?? DEFAULT_IMAGE_OUTPUT,
  });
  return {
    // ★ 存量标识归一(design.md 迁移策略表「键空间合并的前置条件(硬约束)」):
    //   image 侧的 `ai-gateway` 指 **BlackSail 自建网关**,而 chat 侧缺省网关实例 id
    //   恰好同名(`instances.ts` 的 DEFAULT_GATEWAY_INSTANCE_ID)。`query()` 把两个命名
    //   空间并进单一 provider 键空间后,不归一就会让同一个 `ai-gateway` 同时代表两个
    //   上游 —— Req 2.2/2.3 端到端失效,且 `PI_WEB_HIDE_PROVIDERS=ai-gateway` 会连带
    //   干掉 3 条 BlackSail 图像模型。故此处必须调归一,不能只让映射表躺在模块里。
    provider: normalizeLegacyProviderId(e.provider),
    id: e.model,
    name: e.label,
    input,
    output,
    source: e.source ?? "self",
  };
}

/** 构造目录组装服务(纯组装,零 env 读取、零 IO)。 */
export function createModelCatalogService(
  deps: ModelCatalogServiceDeps,
): ModelCatalogService {
  const {
    listSelfChat,
    gatewayChat,
    modelPrecedence,
    mergeCatalog,
    imageCatalog,
    gatewayImageCatalog,
    cloudflareImageCatalog,
    hiddenProviders,
    customProviders,
  } = deps;

  /**
   * chat 侧组装,**不**含 hidden 过滤(供 `chatOptions()` 与 `query()` 共用同一份
   * 组装逻辑,任务 4.1 收敛「两个取数方法」的落点之一)。未启用网关时直接返回
   * `self` 原引用,保留 `chatOptions()` 既有的字节一致快路径(Req 1.3)。
   */
  function assembleChatOptions(): ModelOptions {
    const self = listSelfChat();
    if (gatewayChat === undefined) {
      return self;
    }
    if (mergeCatalog === undefined) {
      // ★ 快速失败,不静默降级。退回「未启用」形态在这里是**能跑通**的:网关模型
      //   只是从列表里消失,没有任何报错。那种症状会被当成网关问题排查很久,
      //   而真因是装配点漏传了一个依赖。
      throw new Error(
        "ModelCatalogService: 注入了 gatewayChat 却没有注入 mergeCatalog。" +
          "两者必须同进同出 —— 缺少合并能力时网关模型会从目录里静默消失。" +
          "请在装配处一并传入 mergeModelCatalog。",
      );
    }
    // 聚合形态:merge(不吞并 + provider 收敛实例标识 + 块排序)。
    return mergeCatalog(self.models, gatewayChat.get(), modelPrecedence);
  }

  function chatOptions(): ModelOptions {
    // hidden 过滤;hidden 空集时 excludeProviders 走零拷贝快路径,未启用网关时
    // 返回 self 原引用(字节一致,Req 1.3)。hidden 含 "ai-gateway" 时网关条目因
    // provider="ai-gateway" 被整体剔除(Req 5.3);providers 本就 self-only,不受影响。
    return excludeProviders(assembleChatOptions(), hiddenProviders);
  }

  /**
   * image 侧组装,**不**含 hidden 过滤(供 `imageEntries()` 与 `query()` 共用同一份
   * 组装逻辑,与 `assembleChatOptions()` 对称)。未启用任一网关/Cloudflare 目录时
   * 直接返回 `imageCatalog` 原引用,保留字节一致快路径(Req 4.3)。
   */
  function assembleImageEntries(): readonly CatalogImageEntry[] {
    if (gatewayImageCatalog === undefined && cloudflareImageCatalog === undefined) {
      // 两套可选 provider 都未启用:引用级透传,字节一致(Req 4.3)。
      return imageCatalog;
    }
    // 聚合形态:self 块在前附 source="self",其后依次是网关块与 Cloudflare 块
    // (Req 4.1/4.5)。只启用其一时,另一块为空数组 —— 输出与该 provider 未引入前
    // 逐字节一致。
    return [
      ...imageCatalog.map((e) => ({ ...e, source: "self" as const })),
      ...(gatewayImageCatalog ?? []).map((e) => ({ ...e, source: "ai-gateway" as const })),
      ...(cloudflareImageCatalog ?? []).map((e) => ({ ...e, source: "cloudflare" as const })),
    ];
  }

  function imageEntries(): readonly CatalogImageEntry[] {
    // hidden 过滤(任务 4.4,Req 5.1/5.2):image 侧不再是「不吃 hidden」的例外。
    // hidden 空集时 excludeProviderModels 走零拷贝快路径,未启用网关/Cloudflare 时
    // 返回 imageCatalog 原引用(字节一致,Req 4.3/10.1)。
    return excludeProviderModels(assembleImageEntries(), hiddenProviders);
  }

  /**
   * 自定义 provider 组装(任务 5.3,Req 7.2):`customProviders.providers()` 已按
   * `enabled` 过滤(停用的 provider 在此已经消失,Req 7.5),故这里不再重复判断
   * enabled —— 与 chat/image 两侧「先无条件组装、query() 里统一套 applyHidden」
   * 的结构不同:enabled 过滤在 `ProviderRegistry` 层已经发生,不属于 hidden 名单
   * 语义(两者是两件事:hidden 是部署方强制屏蔽,enabled 是使用者自己的开关)。
   * 未注入 = 空数组,与该来源不存在时一致(零侵入)。
   */
  function assembleCustomProviderModels(): readonly CatalogModel[] {
    if (customProviders === undefined) return [];
    return customProviders.providers().flatMap((def) => {
      const { input, output } = normalizeModalities({ input: def.input, output: def.output });
      return def.models.map((m) => ({
        provider: def.id,
        id: m.id,
        name: m.name ?? m.id,
        input,
        output,
        source: "custom",
      }));
    });
  }

  function query(q: CatalogQuery = {}): CatalogQueryResult {
    const applyHidden = q.applyHidden ?? true;
    const chatRaw = assembleChatOptions();
    const imageRaw = assembleImageEntries();
    // ★ applyHidden 同时控制 chat 与 image 两侧(任务 4.4,Req 5.1):隐藏名单
    //   对全部类型一致生效,不因用途不同而例外。
    const chat = applyHidden ? excludeProviders(chatRaw, hiddenProviders) : chatRaw;
    const chatModels = chat.models.map(toChatCatalogModel);
    // ★ image 侧的隐藏过滤必须在**存量标识归一之后**(design.md「键空间合并的前置条件」):
    //   image 条目的 `ai-gateway` 归一为 `blksails-ai` 后才是它在统一键空间里的真实身份;
    //   若在归一前按原始 provider 过滤,`PI_WEB_HIDE_PROVIDERS=ai-gateway`(意在隐藏 chat
    //   侧缺省网关实例)就会连带干掉 BlackSail 的图像模型 —— 正是同名不同义要消除的症状。
    const imageProjected = imageRaw.map(toImageCatalogModel);
    const imageModels = applyHidden
      ? imageProjected.filter((m) => !hiddenProviders.has(m.provider))
      : imageProjected;
    // 自定义 provider(任务 5.3,Req 7.2):enabled 过滤已在 ProviderRegistry 层完成;
    // hidden 名单同样对其生效(与 chat/image 两侧一致,部署方可强制屏蔽任何来源)。
    const customRaw = assembleCustomProviderModels();
    const customModels = applyHidden
      ? customRaw.filter((m) => !hiddenProviders.has(m.provider))
      : customRaw;

    const filter = { input: q.input, output: q.output };
    const models = [...chatModels, ...imageModels, ...customModels].filter((m) =>
      matchesFilter(m, filter),
    );
    const providers = [...new Set(models.map((m) => m.provider))].sort();
    return { providers, models };
  }

  return { chatOptions, imageEntries, query };
}

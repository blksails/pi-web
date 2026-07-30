/**
 * registry-channel-adapter(spec installer-registry-channel,任务 3.1)——
 * 把 `server/cli/install/registry-channel.ts` 的通道实现**惰性**接进应用层装配。
 *
 * ## 为什么必须惰性(这是硬约束,不是风格偏好)
 *
 * 通道实现经 `server/cli/registry/**` 依赖 `@pi-clouds/registry-client`。该包**不是 npm 依赖**,
 * 是经 vitest / tsconfig / esbuild 三处别名指向兄弟仓源码。dist 生产模式因 esbuild inline 而可用,
 * 但 `pnpm dev:server`(jiti,无别名)解析不到 —— 一旦在模块顶层静态引入,**整个 server 启动即崩**,
 * 与本特性无关的一切功能跟着挂。
 *
 * 惰性 `import()` 把故障面收敛到「真正装线上包」这一条路径上,并归一为可诊断的
 * `BACKEND_UNAVAILABLE`,而不是让服务起不来。这与同目录 `registry-install-port.ts` 是同一裁断。
 *
 * 类型经 `import type` 引入(编译期擦除,不产生运行时依赖),故只有值引入需要走 `import()`。
 *
 * ## 凭据卫生
 *
 * 授予令牌只作为 `consumeToken` 交给 adapter 用于 Authorization 头,不写盘、不进日志、
 * 不进任何返回载荷。
 */
import type {
  RegistryChannel,
  RegistryChannelError,
  RegistryMaterialization,
  RegistryMaterializeOptions,
  Result,
} from "../../../server/cli/install/installer.js";
import type { SourcesGrant } from "./registry-install-port.js";

export interface LazyRegistryChannelOptions {
  /** 源授予取得器;未登录 / 无授予 → undefined(通道据此报 NOT_AUTHENTICATED)。 */
  readonly getSourcesGrant: () => Promise<SourcesGrant | undefined>;
  /** agent 落点根 = agent 源扫描根,使装完即被枚举、选择器与 `/agent list` 立即可见。 */
  readonly agentTargetRoot: string;
  /**
   * plugin 落点根。**必须与 agent 扫描根分开**,否则 plugin 会被源枚举当成 agent 源列出。
   * 且必须是长期位置 —— pi 只把路径记进 `settings.json#plugins[]`,不拷贝内容。
   */
  readonly pluginTargetRoot: string;
  /** 测试注入点:替换惰性加载器,避免测试依赖兄弟仓存在。 */
  readonly loadChannel?: () => Promise<RegistryChannel>;
}

export function createLazyRegistryChannel(options: LazyRegistryChannelOptions): RegistryChannel {
  const load =
    options.loadChannel ??
    (async (): Promise<RegistryChannel> => {
      // ★★ 绝不可提到模块顶层。见文件头。
      const [channelMod, adapterMod] = await Promise.all([
        import("../../../server/cli/install/registry-channel.js"),
        import("../../../server/cli/registry/http-registry-adapter.js"),
      ]);
      return channelMod.createRegistryChannel({
        getRegistry: async () => {
          const grant = await options.getSourcesGrant();
          if (grant === undefined) return undefined;
          return new adapterMod.HttpRegistryAdapter({
            baseUrl: grant.baseUrl,
            consumeToken: grant.token,
          });
        },
        agentTargetRoot: options.agentTargetRoot,
        pluginTargetRoot: options.pluginTargetRoot,
      });
    });

  return {
    async materialize(
      spec: string,
      opts: RegistryMaterializeOptions,
    ): Promise<Result<RegistryMaterialization, RegistryChannelError>> {
      let channel: RegistryChannel;
      try {
        channel = await load();
      } catch {
        // 归一为可诊断的失败,不抛穿 —— 抛穿会让 host 命令返回 500 而不是一张失败卡片。
        return { ok: false, error: { code: "BACKEND_UNAVAILABLE" } };
      }
      return channel.materialize(spec, opts);
    },
  };
}

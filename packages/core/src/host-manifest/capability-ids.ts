/**
 * v1 能力面 id 名册 —— **已冻结**(spec: host-contract-ports,任务 5.2;Req 6.1)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §5.3。该表与本文件必须逐字一致,
 * `test/host-manifest/compose.test.ts` 直接解析契约文档做对照 —— 单改一处即红。
 *
 * ⚠ **id 一经冻结不得改名**:改名是破坏性变更,须升契约版本(契约 §1/§5.2 第 4 条)。
 *
 * 基线为 `lib/app/pi-handler.ts` 现有的 **17** 个注入式路由工厂,减去两个按集成设计 §5
 * 判定为**领域泄漏**的工具模型清单端点(`aigc.models` / `vision.models` —— 它们将被
 * **删除**而非表态,故不入册),得 15 个路由能力;再加 1 个非路由的宿主命令能力
 * (`host.commands`,它今天正因无表态而在云端静默缺席),共 **16** 项。
 *
 * 本期**只交付名册**;id 到真实工厂的绑定属后续阶段(Req 10.4 明令本期不改既有装配)。
 *
 * pi-SDK-free:纯常量。
 */

/**
 * v1 冻结名册(16 项)。顺序与契约 §5.3 表格一致,注释标注对应的现工厂。
 */
export const HOST_CAPABILITY_IDS_V1: readonly string[] = Object.freeze([
  "config.domains", // createConfigRoutes
  "config.mcp", // createMcpConfigRoutes
  "config.sandboxProject", // createSandboxProjectRoutes
  "config.source", // createSourceSettingsRoutes
  "config.extensions", // createExtensionsConfigRoutes
  "session.list", // createSessionListRoutes
  "session.actions", // createSessionActionsRoutes
  "agentSource.list", // createAgentSourcesRoutes
  "agentSource.favorites", // createFavoritesRoutes
  "gateway.llm", // createLlmGatewayRoutes
  "gateway.ai", // createAiGatewayRoutes
  "auth.session", // createAuthRoutes
  "attachment.routes", // createAttachmentRoutes
  "shell.bash", // createBashRoutes
  "extension.manage", // createExtensionRoutes
  "host.commands", // hostCommands(非路由,但同样必须表态)
]);

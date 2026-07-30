/**
 * 模型 provider 命名空间常量(spec: kernel-boundary-decoupling,任务 4.2)。
 *
 * 这些字符串是**跨层共享的标识**:前端目录条目、runner 的 registry 注册、装配层的 env 下发
 * 三处必须逐字一致 —— 任一处漂移的表现是「列表里看得到、选中却说模型未找到」。
 *
 * ★ 为什么住在顶层中立位置而不是各自的 adapter 目录:runner 在**解析失败的文案分化**里
 *   需要认得「ai-gateway」这个命名空间(它要告诉用户「该模型来自 ai-gateway 目录,
 *   常见成因是网关套件未启用…」)。若从 adapter 目录导入,`runner → adapters` 的跨层边
 *   就回来了;若在 runner 里再写一份字面量,就制造了必须手工同步的第二处事实源
 *   —— 而 ai-gateway 的源码注释里已经为此留过告警。
 *
 * ★ 常量放这里**不等于**实现放这里:具体的 provider 注册逻辑仍在各自的 adapter 模块。
 */

/** AI 网关目录模型的 provider 命名空间。 */
export const AI_GATEWAY_PROVIDER_NAME = "ai-gateway";

/** 云端 egress 模型的 provider 命名空间。 */
export const EGRESS_PROVIDER_NAME = "pi-cloud";

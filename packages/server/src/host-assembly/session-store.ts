/**
 * host-assembly · 会话事件 store 的**装配缝**(spec: core-package-extraction,任务 4.1)。
 *
 * runner 需要在子进程里建一个 store 来镜像会话事件,但"按配置挑后端"要认识每个后端实现,
 * 其中 postgres 值依赖 `pg` —— 那属 adapters,而 runner 与 adapters **同层**,彼此不得依赖。
 *
 * 解法沿用本包已有的先例:与 `model-sources.ts` 一样,由 runner 以**动态 import** 取用
 * (`runner → host-assembly` 已在 ALLOWED_EDGES 中登记为运行期组合)。装配缝落在这里,
 * 而不是让 runner 直接 import adapters —— 后者拆包后就是一条实打实的反向依赖。
 *
 * ★ 与 model-sources 同一考量:runner 有**两条**被支持的入口,装配缝只放一条上会让另一条
 *   静默丢能力。此处由 runner 的公共路径调用,两条入口都经过。
 */
export { createSessionEntryStore } from "../session-store-postgres/factory.js";

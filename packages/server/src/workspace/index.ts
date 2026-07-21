/**
 * workspace —— 宿主状态存储端口(spec: host-contract-ports,任务 6.1;Req 10.1)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3。
 *
 * pi-SDK-free:本模块五个文件的**全部**外部导入是——`local-workspace.ts` 的 `node:crypto`
 * / `node:fs` / `node:os` / `node:path`,以及 `types.ts` 与 `local-workspace.ts` 两个文件
 * 对同仓 `../host-contract-version.js`(纯常量模块)的引用;`key.ts`/`merge.ts` 只从本目录
 * 取类型,`limit-config.ts` 零 import。**无 pi SDK 值导入**,可安全经 server 主 barrel
 * 重导出 —— 主入口那条导出行由任务 6.2 添加,不在本任务边界内。
 *
 * 出口面的取舍(只列**端口契约的公开面**:两端据以实现或装配所需的符号):
 *  - **不导出** `resolveWorkspaceKeyPath` / `resolveLocalWorkspaceRoots` / `LocalWorkspaceRoots`
 *    ——它们在各自文件里导出的理由是「值得被直接单测」(见其文档注释),不是给宿主调用的。
 *    两条依据:
 *    ① **层次错位**:键→路径是 **fs 载体专有**的概念,对扁平 KV 载体(如 pi-clouds 的
 *      `TenantWorkspace`)毫无意义;本出口是**载体无关**的端口面,放进来即错层。
 *    ② **绕过端口的近路**:宿主拿到路径就能直接读写文件,从而绕过原子写、0600 权限、
 *      单键值上限与值/分组同址校验。
 *    ⚠ 这里**不适用**「封住安全边界」的说法:契约 §3.2 把安全边界指派给**键校验**,而
 *    `validateWorkspaceKey`/`assertWorkspaceKey` 恰恰是**导出**的;`resolveWorkspaceKeyPath`
 *    第一件事也正是调它,故键校验反倒绕不过。初稿此处曾写「键→路径映射是本端口封起来的
 *    那条安全边界」,与契约不符,会让读者误以为安全边界没被导出——已据复核更正。
 *    测试按文件路径 import,不受本取舍影响。
 *  - **不导出** `./testing` 下的一致性套件与其类型:那是 `@blksails/pi-web-server/testing`
 *    子路径的事(任务 6.3)。测试套件出现在生产出口里,会随主 barrel 进入运行期产物,
 *    且让「对外只认 LocalWorkspace 一个参照实现」的边界失守。
 */
export {
  WorkspaceCorruptError,
  WorkspaceError,
  WorkspaceIoError,
  WorkspaceKeyError,
  WorkspaceLimitError,
  type JsonObject,
  type Workspace,
  type WorkspaceErrorCode,
  type WorkspaceKey,
  type WorkspaceNamespace,
  type WorkspaceWriteOptions,
} from "./types.js";
export { assertWorkspaceKey, validateWorkspaceKey } from "./key.js";
export {
  DEFAULT_WORKSPACE_MAX_VALUE_BYTES,
  WORKSPACE_MAX_VALUE_BYTES_ENV,
  WorkspaceConfigError,
  resolveWorkspaceValueLimit,
} from "./limit-config.js";
export { deepMergeJson } from "./merge.js";
export {
  createLocalWorkspace,
  createLocalWorkspaceNamespace,
  type LocalWorkspaceNamespaceOptions,
  type LocalWorkspaceOptions,
} from "./local-workspace.js";

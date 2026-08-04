/**
 * install-sources — 可安装来源枚举端口(spec agent-plugin-commands,任务 1.1)。
 *
 * 与 `agent-source-list` 的 `AgentSourceProvider` 同族:**只读、无副作用的枚举抽象**,
 * 一个 `list` 方法,实现可换。此前 `GET /sessions/:id/install-sources` 直接 `node:fs` 扫盘,
 * 非本地形态(云端/沙箱)无处替换;端口化后本地扫描降为其默认实现之一。
 *
 * 边界(design.md「Out of Boundary」):
 *  - **不**依赖宿主状态端口 `Workspace`。后者只承载 JSON 文档状态(见 `workspace/types.ts`
 *    的边界宣言),把文件系统枚举塞进去会使其退化为万能对象。
 *  - **不**依赖 `SessionStore` 或任何 HTTP 类型:解析基准由调用方以 `cwd` 传入,
 *    会话查找留在路由层。
 *
 * 零 IO、零 pi-SDK 依赖,可安全经 server 主 barrel 重导出。
 */

/** 一个可安装来源候选。 */
export interface InstallSourceRecord {
  /** 展示路径(相对解析基准,形如 `./examples/foo`)。 */
  readonly path: string;
  /** 可直接提交给安装命令的来源串(形如 `local:./examples/foo`)。 */
  readonly insertText: string;
}

/** 枚举查询。 */
export interface InstallSourceQuery {
  /** 解析基准目录(绝对路径)。通常是会话 cwd —— 与执行侧同基准是硬要求:补全给出的候选
   *  必须能被同一次安装调用解析,否则选中候选提交即失败。 */
  readonly cwd: string;
  /** 前缀/子串过滤;空串表示不过滤。 */
  readonly query: string;
}

/**
 * 可安装来源的只读枚举端口。
 *
 * 后置条件(实现须遵守):返回项的真实路径必仍位于 `cwd` 之内 —— 这是**安全边界**,
 * 不是便利检查,符号链接逃逸会泄露基准目录之外的路径。
 */
export interface InstallSourceProvider {
  list(q: InstallSourceQuery): Promise<readonly InstallSourceRecord[]>;
}

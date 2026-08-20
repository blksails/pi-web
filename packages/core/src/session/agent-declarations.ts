/**
 * agent-declarations — agent 在**装配期**经声明帧告知主进程的只读投影。
 *
 * 自 `PiSession` 提出(H1 职责簇拆分)。四个字段原本散在会话类里,但它们是同一个模式重复
 * 四遍:「装配期收一帧 → 按会话缓存 → 提供 getter」。每加一种声明就再抄一遍,而它们与
 * 会话的 RPC / 生命周期 / 附件转发都不相干。
 *
 * ## 共同语义(四者一致,由本模块统一承载)
 *
 *  - **早于就绪门**:声明帧在 `lifecycle: ready` 之前就到,故读取方不得假设会话已就绪;
 *  - **未声明有确定值**:`[]` / `[]` / `undefined` / `false` —— 存量 agent 不发这些帧,
 *    读到缺省即「该能力未声明」,不是错误;
 *  - **一次性**:agent 装配期发一次,会话存续期不变(重启 runner 会重建会话对象);
 *  - **只读投影**:handler 与函数引用一律留在子进程,这里只有纯数据。
 *
 * ★ 校验不在本模块:帧的 schema 校验与白名单核对在 `raw-line-router` 的表条目里完成,
 *   到这里的值已经是合法的。把校验也塞进来会让本模块反过来依赖 env 与拓扑。
 */
import type { AgentRouteDeclDto, SlashCompletionDecl } from "@blksails/pi-web-protocol";

/**
 * 一个会话的 agent 声明缓存。
 *
 * 写入方唯一:`raw-line-router` 的四个声明帧条目。读取方:completion provider、
 * agent-route 路由、附件上传路由、catalog provider。
 */
export class AgentDeclarations {
  private _slashCompletions: readonly SlashCompletionDecl[] = [];
  private _routes: readonly AgentRouteDeclDto[] = [];
  private routesDeclared = false;
  private readonly routeWaiters = new Set<() => void>();
  private _attachmentWriteProfile: string | undefined;
  private _attachmentCatalogAvailable = false;

  /** 静态 slash 补全候选(spec agent-slash-completion)。未声明 → `[]`。 */
  get slashCompletions(): readonly SlashCompletionDecl[] {
    return this._slashCompletions;
  }
  setSlashCompletions(items: readonly SlashCompletionDecl[]): void {
    this._slashCompletions = items;
  }

  /** routes 路由表纯数据投影(spec agent-declared-routes,Req 2.5)。未声明 → `[]`。 */
  get routes(): readonly AgentRouteDeclDto[] {
    return this._routes;
  }
  setRoutes(routes: readonly AgentRouteDeclDto[]): void {
    this._routes = routes;
    this.routesDeclared = true;
    for (const resolve of this.routeWaiters) resolve();
    this.routeWaiters.clear();
  }

  /**
   * 等待装配期路由声明帧到达。声明帧早于 ready，但 HTTP 首请求可能先抵达；
   * 超时后仍按「未声明」语义继续，不把旧 agent 卡死。
   */
  waitForRoutes(timeoutMs: number): Promise<void> {
    if (this.routesDeclared || timeoutMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.routeWaiters.delete(finish);
        resolve();
      };
      const timer = setTimeout(finish, timeoutMs);
      if (typeof timer.unref === "function") timer.unref();
      this.routeWaiters.add(finish);
    });
  }

  /** 会话终态时放行等待者；调用方再按当前清单判定。 */
  releaseRouteWaiters(): void {
    for (const resolve of this.routeWaiters) resolve();
    this.routeWaiters.clear();
  }

  /**
   * 附件写目标 profile 名(spec agent-attachment-profile)。未声明 / 关断 / 校验失配 →
   * `undefined`(Req 5.1),读取方据此回落宿主默认写路由。
   */
  get attachmentWriteProfile(): string | undefined {
    return this._attachmentWriteProfile;
  }
  setAttachmentWriteProfile(profile: string): void {
    this._attachmentWriteProfile = profile;
  }

  /** 动态附件目录是否可用(spec agent-attachment-catalog)。未声明 → `false`(Req 1.2)。 */
  get attachmentCatalogAvailable(): boolean {
    return this._attachmentCatalogAvailable;
  }
  markAttachmentCatalogAvailable(): void {
    this._attachmentCatalogAvailable = true;
  }
}

/**
 * readiness-probe — 就绪探针的**机制**(定时器与竞态收敛),不含生命周期状态本身。
 *
 * 自 `PiSession` 提出(H1 职责簇拆分)。这里的**切分依据**值得写清楚,因为它不是按名字切的:
 *
 *  - **机制出**:两个定时器(探针超时、重启 settle)、`settled` 竞态收敛、`unref` ——
 *    这些是纯粹的时序管理,与「会话是什么」无关,却贡献了这一簇几乎全部的复杂度与
 *    全部的泄漏风险(三个不同路径都要记得清定时器);
 *  - **状态留**:`lifecycle` / `detail` / `code` 与 `setLifecycle` 留在 `PiSession` ——
 *    它们经 `describe()` 与快照对外暴露,是会话**自身的身份状态**。把它们也搬走,会让
 *    会话变成一个转发壳,读代码的人反而要跳两个文件才能回答「这个会话现在什么状态」。
 *
 * 换句话说:出去的是「怎么探、什么时候探」,留下的是「探出来是什么」。
 */

/** {@link ReadinessProbe} 的注入依赖。 */
export interface ReadinessProbeDeps {
  /** 探针超时(毫秒)。超时未响应 → `onFailure("probe-timeout", …)`。 */
  readonly timeoutMs: number;
  /**
   * 只读探针本身。以**首条响应**为真实就绪锚点(有响应即证明 agent 读循环已起、
   * session 已绑定);响应内容不看,error 响应同样算就绪。
   */
  readonly probe: () => Promise<unknown>;
  /**
   * 是否允许开始一次探测。由调用方判定(通常是「会话 active 且生命周期为 initializing」)——
   * 探针不认识生命周期,只问「现在能不能探」。
   */
  readonly canStart: () => boolean;
  /** 探针成功。 */
  readonly onReady: () => void;
  /** 探针失败。`code` 区分超时与拒绝/抛出,供上层落到 lifecycle 的 detail/code。 */
  readonly onFailure: (code: "probe-timeout" | "probe-failed", detail: string) => void;
}

/**
 * 就绪探针。
 *
 * 竞态保证:一次 `start()` 内,超时与响应**只认先到的那个**(`settled` 收敛),后到者
 * 完全无副作用 —— 否则「超时判错 + 随后响应判对」会连发两次生命周期变更。
 */
export class ReadinessProbe {
  private probeTimer: ReturnType<typeof setTimeout> | undefined;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: ReadinessProbeDeps) {}

  /** 发起一次探测。`canStart()` 为假时静默跳过。 */
  start(): void {
    if (!this.deps.canStart()) return;
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      this.clearProbeTimer();
      return true;
    };

    const timer = setTimeout(() => {
      if (!finish()) return;
      this.deps.onFailure("probe-timeout", "readiness probe timed out");
    }, this.deps.timeoutMs);
    // ★ unref:探针定时器不应把进程钉在事件循环里 —— 否则一个从未响应的 agent 会让
    //   宿主进程在该退出时退不掉。
    if (typeof timer.unref === "function") timer.unref();
    this.probeTimer = timer;

    let pending: Promise<unknown>;
    try {
      pending = this.deps.probe();
    } catch (err) {
      // 同步抛出(极少):归一为探针失败,与 reject 分支同处置。
      if (finish()) {
        this.deps.onFailure("probe-failed", `readiness probe threw: ${String(err)}`);
      }
      return;
    }
    void pending.then(
      () => {
        // 有响应(含 error 响应)即就绪:读循环已处理命令并回包。
        if (finish()) this.deps.onReady();
      },
      () => {
        if (finish()) this.deps.onFailure("probe-failed", "readiness probe rejected");
      },
    );
  }

  /**
   * 延迟 `delayMs` 后探测一次(runner 重启的 settle 窗口:避免探针写进将死的旧 stdin)。
   * 重复调用以最后一次为准 —— 前一个 settle 定时器被取消。
   */
  startAfter(delayMs: number): void {
    if (this.settleTimer !== undefined) clearTimeout(this.settleTimer);
    const t = setTimeout(() => {
      this.settleTimer = undefined;
      this.start();
    }, delayMs);
    if (typeof t.unref === "function") t.unref();
    this.settleTimer = t;
  }

  /**
   * 取消在途探测与待触发的 settle。
   *
   * ★ 幂等,且是**唯一**的清理入口:改造前三条路径(重启、真实重生、会话收尾)各自手写
   *   `if (timer !== undefined) { clearTimeout; timer = undefined }` 两遍,漏一处就是
   *   一个悬挂定时器打到已收尾的会话上。
   */
  cancel(): void {
    this.clearProbeTimer();
    if (this.settleTimer !== undefined) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
  }

  private clearProbeTimer(): void {
    if (this.probeTimer !== undefined) {
      clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
    }
  }
}

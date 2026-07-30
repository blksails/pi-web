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

/**
 * 就绪探针的**重发间隔**(毫秒)。
 *
 * ## ★ 为什么必须重发,而不是只发一次
 *
 * `start()` 由 `PiSession` 在构造函数里紧跟 spawn 调用,此时子进程**尚未挂上 stdin
 * 读取器** ——「先写进 stdin 的那一行会被静默丢弃」在本仓**实测成立**,不是被缓冲后补读。
 *
 * 判别实验(同一 runner / 同一 agent 目录 / 同一帧,唯一变量是写入时机):
 *
 * | 写入时机 | runner 进入 rpc 模式 | 结果 |
 * |---|---|---|
 * | spawn 瞬间(t=0) | 2991 ms | **70 秒全程无回应** |
 * | 启动之后(t=40s)  | 3116 ms | **9 ms 收到 response** |
 *
 * ⇒ 丢的是**请求**,不是响应迟到。由此推出两条,少想一条就会修错方向:
 *   ① **把 `timeoutMs` 调大完全无效** —— 实测抬到 120s 仍 `probe-timeout`(120003 ms)。
 *      请求已经不在了,等多久都不会有人回。
 *   ② **症状是间歇的**,因为它是竞态:启动快慢随扩展/包数量与机器负载漂移,
 *      同一份配置连跑三次可能 2.5s ready / 22s ready / 直接超时。
 *      「偶发」在这里不是玄学,是竞态的正常表现。
 *
 * 取 1s 是两头夹出来的:小于它则在慢启动(实测带 5 个声明包时约 9–22s)期间堆积几十条
 * 永不 resolve 的 pending 记录;大于它则子进程刚就绪的那一刻要多等一拍才被发现。
 * **首发仍在 `start()` 调用时立即进行**,故快路径零额外延迟 —— 重发只在首发落空时起作用。
 *
 * ⚠ 重发安全的前提是 `deps.probe()` 为**只读**命令(`get_commands`,见本文件头与
 *   `ReadinessProbeDeps.probe` 的契约)。换成有副作用的命令前必须先重新论证。
 */
const READINESS_PROBE_RETRY_MS = 1_000;

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
  /** 重发定时器(见 {@link READINESS_PROBE_RETRY_MS});与 probeTimer 同生共死。 */
  private retryTimer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: ReadinessProbeDeps) {}

  /**
   * 发起探测。`canStart()` 为假时静默跳过。
   *
   * 首发立即进行;若首发落空(请求被尚未挂上读取器的子进程丢弃 —— 见
   * {@link READINESS_PROBE_RETRY_MS} 的判别实验),则在超时截止前**按固定间隔重发**,
   * 收到首个响应即就绪。
   */
  start(): void {
    if (!this.deps.canStart()) return;
    let settled = false;
    const finish = (): boolean => {
      if (settled) return false;
      settled = true;
      this.clearProbeTimer();
      this.clearRetryTimer();
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

    const attempt = (): void => {
      if (settled) return;
      // 调用方已判定「现在不能探」(会话收尾/重生中):停止重发,交由对应路径收尾。
      if (!this.deps.canStart()) {
        this.clearRetryTimer();
        return;
      }
      let pending: Promise<unknown>;
      try {
        pending = this.deps.probe();
      } catch (err) {
        // 同步抛出(极少):归一为探针失败,与 reject 分支同处置。**不重试**(确定性失败)。
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
          // ⚠ 拒绝**不重试**:ChannelClosedError 一类是确定性失败,重试只会把准确的
          //   probe-failed 拖成含糊的 probe-timeout。
          if (finish()) this.deps.onFailure("probe-failed", "readiness probe rejected");
        },
      );
    };

    attempt(); // 首发保持原有时序 ⇒ 快路径零额外延迟。
    if (settled) return;

    const retry = setInterval(attempt, READINESS_PROBE_RETRY_MS);
    if (typeof retry.unref === "function") retry.unref();
    this.retryTimer = retry;
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
    this.clearRetryTimer();
    if (this.settleTimer !== undefined) {
      clearTimeout(this.settleTimer);
      this.settleTimer = undefined;
    }
  }

  private clearRetryTimer(): void {
    if (this.retryTimer !== undefined) {
      clearInterval(this.retryTimer);
      this.retryTimer = undefined;
    }
  }

  private clearProbeTimer(): void {
    if (this.probeTimer !== undefined) {
      clearTimeout(this.probeTimer);
      this.probeTimer = undefined;
    }
  }
}

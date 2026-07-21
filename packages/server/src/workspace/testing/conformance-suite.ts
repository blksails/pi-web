/**
 * Workspace 一致性测试套件 —— **契约的可执行部分**
 * (spec: host-contract-ports,任务 3.1/3.2/3.3;Req 8.1-8.6)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3.8。
 *
 * 目的:使「某个实现是否符合契约」由**测试判定**,而非由各端对文档的解读判定。
 * pi-web 的 `LocalWorkspace` 与 pi-clouds 的 `TenantWorkspace` 必须跑同一套用例且全绿;
 * 契约冲突因此暴露在各自的测试里,而不是等到联调。
 *
 * ⚠ 两条硬约束(与兄弟仓 `pi-clouds/packages/registry-client/src/testing/` 的结论一致):
 *
 *  1. **框架无关**:本文件**不 import 任何测试框架**,由调用方传入 `describe`/`it`
 *     ({@link SuiteRunner}),断言用 `node:assert`。套件要跨仓运行,两端的测试框架与
 *     `globals` 配置不受 pi-web 控制。
 *
 *  2. **错误判别按 `code`,不用 `instanceof`**:跨包/跨仓时同名类可能来自不同模块实例,
 *     `instanceof` 会**假阴性** —— 测试看起来通过,实际什么都没验到。
 *
 * 用例逐条锚定 requirements 的验收编号,复核时按需求而非按实现读(防自证循环)。
 */
import assert from "node:assert/strict";
import type {
  JsonObject,
  Workspace,
  WorkspaceErrorCode,
  WorkspaceKey,
  WorkspaceNamespace,
} from "../types.js";

/** 最小测试框架契约。vitest / jest / node:test 均可满足。 */
export interface SuiteRunner {
  describe(name: string, fn: () => void): void;
  it(name: string, fn: () => void | Promise<void>): void;
}

/** 被测实例及其钩子。 */
export interface ConformanceTarget {
  readonly workspace: Workspace;
  cleanup(): Promise<void>;
  /**
   * 把指定键的既有值破坏为**非法 JSON**,供「读取遇损坏必须抛错」用例使用(Req 2.2)。
   * 本地实现写坏文件;远端实现写坏行。
   *
   * ⚠ **必填而非可选。** 损坏发生在端口之下,无法经 `Workspace` API 自身构造。若设为可选,
   * 未提供它的实现会**静默跳过**这条用例:套件报绿,而该实现遇到损坏数据时的行为从未被
   * 验证过 —— 那正是本契约要消灭的「缺失与弃用不可区分」。
   */
  corrupt(namespace: NamespaceName, key: WorkspaceKey): Promise<void>;
  /**
   * 以新选项重新打开**同一份既有数据**,返回新的 {@link Workspace}(Req 3.5)。
   *
   * ⚠ **必填。** 工厂按契约每次产出**相互隔离**的实例(否则用例间串数据),因此
   * 「上限调小后既有超限值仍可读」这类**跨配置读同一份数据**的场景根本无法用两个
   * 工厂实例构造 —— 新实例看不到旧实例写的东西。缺了本钩子,那条验收只能被降格成
   * 两个互不相干的弱断言,看似通过实则从未验证。
   */
  reopen(opts?: ConformanceTargetOptions): Promise<Workspace>;
  /**
   * 本实现的**载体**是否大小写敏感(契约 §3.2 第 4 条 / 勘误⑦)。缺省 `true`(契约语义)。
   *
   * ⚠ 这是**实现声明其平台限制**的唯一入口,不是豁免开关:声明 `false` 后,大小写用例
   * 改为断言「两键确实互为别名、后写者胜出、列举只回一条」——声称不敏感却实际敏感的
   * 实现照样红。若做成「声明即跳过」,任何实现都能靠声明把红改绿。
   *
   * 落在 `ConformanceTarget` 而非 {@link ConformanceTargetOptions}:后者是套件**传入**的
   * 需求,本字段是实现**报出**的载体事实,方向相反。且它可能取决于运行时载体(同一份
   * `LocalWorkspace` 代码在 Linux ext4 上敏感、在 macOS APFS 上不敏感),故须由工厂在
   * 探测真实载体后填写,不能写死在套件调用处。
   */
  readonly caseSensitiveKeys?: boolean;
}

/**
 * 工厂参数(Req 8.6)。
 *
 * ⚠ 上限**必须**可由参数指定:套件验证的是上限**行为**而非上限**来源**。若套件为构造
 * 「上限调小」场景而改写 `process.env`,既违反 env 装配期 fail-fast 纪律,也对不读该
 * 变量的云端实现毫无意义。
 */
export interface ConformanceTargetOptions {
  readonly maxValueBytes?: number;
}

/**
 * 被测实例工厂。
 *
 * ⚠ **每次调用必须产出相互隔离的实例**(不同临时根),否则用例间会串数据。
 */
export type ConformanceFactory = (
  opts?: ConformanceTargetOptions,
) => Promise<ConformanceTarget>;

/** 两个命名空间的遍历入口(双根须逐一验收,Req 4.1)。 */
const NAMESPACES = ["user", "project"] as const;
/** 命名空间名。 */
export type NamespaceName = (typeof NAMESPACES)[number];

const nsOf = (ws: Workspace, name: NamespaceName): WorkspaceNamespace => ws[name];

/** 取错误的稳定判别码;非 Workspace 错误返回 `undefined`。 */
function codeOf(err: unknown): WorkspaceErrorCode | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const c = (err as { code?: unknown }).code;
  return c === "key" || c === "limit" || c === "corrupt" || c === "io"
    ? c
    : undefined;
}

/** 断言 `fn` 抛出带指定判别码的错误(**不用 instanceof**)。 */
export async function assertRejectsWithCode(
  fn: () => Promise<unknown>,
  expected: WorkspaceErrorCode,
  message: string,
): Promise<void> {
  let caught: unknown;
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert.equal(threw, true, `${message}: expected to reject, but it resolved`);
  const actual = codeOf(caught);
  assert.equal(
    actual,
    expected,
    `${message}: expected error code ${expected}, got ${String(actual)} (${String(caught)})`,
  );
}

/** 取实例 → 跑用例 → 无论成败都清理(需要钩子时用 {@link withRawTarget})。 */
export async function withTarget(
  factory: ConformanceFactory,
  fn: (ws: Workspace) => Promise<void>,
  opts?: ConformanceTargetOptions,
): Promise<void> {
  await withRawTarget(factory, (t) => fn(t.workspace), opts);
}

/** 同 {@link withTarget},但把整个 target 交给回调(损坏用例需要 `corrupt` 钩子)。 */
export async function withRawTarget(
  factory: ConformanceFactory,
  fn: (target: ConformanceTarget) => Promise<void>,
  opts?: ConformanceTargetOptions,
): Promise<void> {
  const target = await factory(opts);
  try {
    await fn(target);
  } finally {
    await target.cleanup();
  }
}

/**
 * 非法键**穷举清单**(Req 1.1-1.4)。
 *
 * 这是安全边界:实现把键映射为真实路径,任何遗漏即为路径穿越。故穷举而非抽样。
 */
const INVALID_KEYS: readonly { readonly key: string; readonly why: string }[] = [
  { key: "", why: "空串" },
  { key: "/abs.json", why: "绝对路径" },
  { key: "/", why: "仅分隔符" },
  { key: "..", why: "相对段 .." },
  { key: ".", why: "相对段 ." },
  { key: "../secrets.json", why: "前导 .." },
  { key: "a/../../etc/passwd", why: "中段 .. 穿越" },
  { key: "a/./b.json", why: "中段 ." },
  { key: "a/..", why: "尾段 .." },
  { key: "a//b.json", why: "连续分隔符" },
  { key: "a/", why: "尾随分隔符" },
  { key: "a\\b.json", why: "反斜杠" },
  { key: "..\\secrets.json", why: "反斜杠穿越" },
  { key: "a\0b.json", why: "空字符" },
];

/** 合法键样本 —— 防「校验写太紧」的反向缺陷(Req 1.6)。 */
const VALID_KEYS: readonly string[] = [
  "settings.json",
  "a/b.json",
  "sources/0123456789abcdef/settings.json",
  // 段内含点合法:只有**整段**等于 "." 或 ".." 才非法。
  "..hidden.json",
  "x..",
  "a.b/c..d.json",
];

const SAMPLE: JsonObject = { hello: "world" };

/** 读写语义与双根隔离用例组(Req 2.1-2.9 / 4.1-4.4 / 8.2)。 */
function readWriteCases(runner: SuiteRunner, factory: ConformanceFactory): void {
  const { describe, it } = runner;

  describe("读写语义(Req 2.1-2.9)", () => {
    for (const ns of NAMESPACES) {
      it(`[${ns}] 不存在的键读为空对象,不抛(Req 2.1)`, async () => {
        await withTarget(factory, async (ws) => {
          assert.deepEqual(await nsOf(ws, ns).readJson("absent.json"), {});
        });
      });

      it(`[${ns}] 既有值损坏 → 抛 corrupt,**不得**静默返回空对象(Req 2.2)`, async () => {
        // 静默返回 {} 会让一次损坏被当作"空配置",随后被下一次写入整体覆盖 —— 静默数据丢失。
        await withRawTarget(factory, async (t) => {
          const n = nsOf(t.workspace, ns);
          await n.writeJson("broken.json", { a: 1 });
          await t.corrupt(ns, "broken.json");
          await assertRejectsWithCode(
            () => n.readJson("broken.json"),
            "corrupt",
            `[${ns}] 损坏值读取`,
          );
        });
      });

      it(`[${ns}] 缺省合并:递归合并且保留未涉及字段(Req 2.3)`, async () => {
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          await n.writeJson("m.json", { a: { x: 1, y: 2 }, keep: "yes" });
          await n.writeJson("m.json", { a: { y: 20, z: 30 } });
          assert.deepEqual(await n.readJson("m.json"), {
            a: { x: 1, y: 20, z: 30 },
            keep: "yes",
          });
        });
      });

      it(`[${ns}] 缺省合并:数组整体替换,不拼接(Req 2.3)`, async () => {
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          await n.writeJson("arr.json", { list: [1, 2, 3] });
          await n.writeJson("arr.json", { list: [9] });
          assert.deepEqual(await n.readJson("arr.json"), { list: [9] });
        });
      });

      it(`[${ns}] merge:false 整体覆盖,使未提供的字段被删除(Req 2.4)`, async () => {
        // 这条是「删除语义」的唯一载体:secret 清空、provider 删除都依赖它。
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          await n.writeJson("o.json", { a: 1, b: 2, nested: { x: 1 } });
          await n.writeJson("o.json", { a: 9 }, { merge: false });
          assert.deepEqual(await n.readJson("o.json"), { a: 9 });
        });
      });

      it(`[${ns}] 读己之写:写入 resolve 后立即可读到新值(Req 2.5)`, async () => {
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          for (let i = 0; i < 5; i += 1) {
            await n.writeJson("rw.json", { i }, { merge: false });
            assert.deepEqual(await n.readJson("rw.json"), { i });
          }
        });
      });

      it(`[${ns}] list 只返回直接子级的值键,不递归也不展开分组(Req 2.7)`, async () => {
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          await n.writeJson("g/a.json", SAMPLE);
          await n.writeJson("g/b.json", SAMPLE);
          await n.writeJson("g/deep/c.json", SAMPLE);
          await n.writeJson("other/d.json", SAMPLE);
          assert.deepEqual(await n.list("g"), ["g/a.json", "g/b.json"]);
        });
      });

      it(`[${ns}] list 按**码元序**升序,不使用区域相关排序(Req 2.7)`, async () => {
        // 码元序下 `1`(U+0031) < `B`(U+0042) < `_`(U+005F) < `a`(U+0061)。
        // `localeCompare`(en)会给出 `_`,`1`,`a`,`B` —— 与本断言的期望**逐位不同**,
        // 故本用例能确定性地区分两种排序口径,而不是碰巧通过。
        //
        // ⚠ **刻意不含仅大小写不同的键对**(契约 §3.2 第 4 条 / 勘误⑦):`A.json` 与
        // `a.json` 在大小写不敏感载体(macOS APFS / Windows NTFS 默认)上塌成**同一个
        // 文件**,列举只会回来一条,排序断言在半数宿主上**原理上无法成立** —— 那不是被测
        // 实现排序写错了,而是用例把「排序口径」与「键大小写敏感」两个维度耦合在了一起。
        // 大小写敏感另立用例(见键空间组),并允许实现声明其为平台不适用。
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          for (const k of ["s/a.json", "s/_u.json", "s/B.json", "s/1.json"]) {
            await n.writeJson(k, SAMPLE);
          }
          assert.deepEqual(await n.list("s"), [
            "s/1.json",
            "s/B.json",
            "s/_u.json",
            "s/a.json",
          ]);
        });
      });

      it(`[${ns}] list 无匹配返回空数组(Req 2.7)`, async () => {
        await withTarget(factory, async (ws) => {
          assert.deepEqual(await nsOf(ws, ns).list("nothing/here"), []);
        });
      });

      it(`[${ns}] delete 幂等:删不存在的键成功且不抛(Req 2.8)`, async () => {
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          await n.delete("never.json");
          await n.writeJson("d.json", SAMPLE);
          await n.delete("d.json");
          await n.delete("d.json");
          assert.equal(await n.exists("d.json"), false);
          assert.deepEqual(await n.readJson("d.json"), {});
        });
      });

      it(`[${ns}] exists 反映存在性(Req 2.9)`, async () => {
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          assert.equal(await n.exists("e.json"), false);
          await n.writeJson("e.json", SAMPLE);
          assert.equal(await n.exists("e.json"), true);
          await n.delete("e.json");
          assert.equal(await n.exists("e.json"), false);
        });
      });
    }
  });

  describe("双根隔离(Req 4.1-4.4)", () => {
    it("同键分写两根,各自独立读回且互不覆盖(Req 4.1/4.2)", async () => {
      await withTarget(factory, async (ws) => {
        await ws.user.writeJson("same.json", { root: "user" }, { merge: false });
        await ws.project.writeJson("same.json", { root: "project" }, { merge: false });
        assert.deepEqual(await ws.user.readJson("same.json"), { root: "user" });
        assert.deepEqual(await ws.project.readJson("same.json"), { root: "project" });
      });
    });

    it("一根删除不影响另一根的同名键(Req 4.3)", async () => {
      await withTarget(factory, async (ws) => {
        await ws.user.writeJson("x.json", SAMPLE);
        await ws.project.writeJson("x.json", SAMPLE);
        await ws.user.delete("x.json");
        assert.equal(await ws.user.exists("x.json"), false);
        assert.equal(await ws.project.exists("x.json"), true);
      });
    });

    it("一根列举不串另一根的键(Req 4.4)", async () => {
      await withTarget(factory, async (ws) => {
        await ws.user.writeJson("g/u.json", SAMPLE);
        await ws.project.writeJson("g/p.json", SAMPLE);
        assert.deepEqual(await ws.user.list("g"), ["g/u.json"]);
        assert.deepEqual(await ws.project.list("g"), ["g/p.json"]);
      });
    });
  });
}

/** 造一个序列化后必定超过 `limit` 字节的值。 */
function oversized(limit: number): JsonObject {
  return { blob: "x".repeat(limit + 64) };
}

/** 上限与并发用例组(Req 2.6 / 3.4 / 3.5 / 8.3 / 8.4)。 */
function limitAndConcurrencyCases(
  runner: SuiteRunner,
  factory: ConformanceFactory,
): void {
  const { describe, it } = runner;

  describe("单键值上限(Req 3.4/3.5,8.3 三例)", () => {
    it("① 写入超过上限 → 抛 limit,且不写入任何内容(Req 3.4)", async () => {
      const limit = 512;
      await withTarget(
        factory,
        async (ws) => {
          await assertRejectsWithCode(
            () => ws.user.writeJson("big.json", oversized(limit)),
            "limit",
            "超限写入",
          );
          // "不写入任何内容":失败的写入不得留下半成品。
          assert.equal(await ws.user.exists("big.json"), false);
          assert.deepEqual(await ws.user.readJson("big.json"), {});
        },
        { maxValueBytes: limit },
      );
    });

    it("② 经工厂参数指定更大上限 → 同一份数据可写入(Req 8.3/8.6)", async () => {
      // 上限来源是实现的装配细节(pi-web 读 env,云端未必);套件只验**行为**,
      // 故经工厂参数取实例,**绝不改写 process.env**。
      const small = 512;
      const value = oversized(small);
      await withTarget(
        factory,
        async (ws) => {
          await ws.user.writeJson("big.json", value);
          assert.deepEqual(await ws.user.readJson("big.json"), value);
        },
        { maxValueBytes: small * 100 },
      );
    });

    it("③ ★ 上限调小后,**同一份既有超限值仍可读**(Req 3.5)", async () => {
      // 若读路径也校验上限,调小上限会使既有数据不可达 —— 数据仍在存储中却读不出,
      // 且用户无法自救(要缩小它必须先读到它)。故上限**只在写路径**校验。
      //
      // ⚠ 必须用 `reopen` 在**同一份数据**上换上限。用两个工厂实例是不等价的:
      // 工厂产出相互隔离的实例,新实例看不到旧实例写的东西,那样只是在验
      // 「大上限能读自己写的」+「小上限拒绝新写入」两件互不相干的事。
      const big = 64 * 1024;
      const small = 512;
      const value = oversized(small); // 小于 big、大于 small

      await withRawTarget(
        factory,
        async (t) => {
          await t.workspace.user.writeJson("legacy.json", value);

          // 同一份数据,换成更小的上限重开。
          const shrunk = await t.reopen({ maxValueBytes: small });

          // 核心断言:读路径不设限 —— 既有超限值必须完整读回。
          assert.deepEqual(
            await shrunk.user.readJson("legacy.json"),
            value,
            "上限调小后,既有超限值必须仍可完整读回(读路径不得校验上限)",
          );

          // 佐证小上限确实已生效:同一实例上再写同尺寸的值必须被拒。
          await assertRejectsWithCode(
            () => shrunk.user.writeJson("legacy.json", value, { merge: false }),
            "limit",
            "调小上限后的写入",
          );
        },
        { maxValueBytes: big },
      );
    });
  });

  describe("并发原子可见性(Req 2.6,8.4)", () => {
    it("并发写入时,读取只见某次写入的完整值,绝不见字段混合体", async () => {
      // 不使用固定等待:以 Promise.all 交错编排读写,避免 flaky。
      // 断言方式:每次读回的对象必须**完整等于**某一次写入的输入(或初始空对象),
      // 不接受字段来自不同批次的混合体 —— 这可确定性地证明"无部分写入",
      // 而不依赖时序运气。契约不承诺线性一致性,也不规定谁最终胜出,故不断言胜者。
      const ROUNDS = 24;
      const writes: JsonObject[] = Array.from({ length: ROUNDS }, (_, i) => ({
        round: i,
        marker: `m-${i}`,
        payload: { nested: i },
      }));

      await withTarget(factory, async (ws) => {
        const n = ws.user;
        const observed: JsonObject[] = [];

        await Promise.all([
          ...writes.map((v) => n.writeJson("race.json", v, { merge: false })),
          ...Array.from({ length: ROUNDS }, async () => {
            observed.push(await n.readJson("race.json"));
          }),
        ]);
        // 收尾再读一次,确保最终态也是完整值。
        observed.push(await n.readJson("race.json"));

        const legal = [{} as JsonObject, ...writes];
        for (const seen of observed) {
          const matched = legal.some(
            (candidate) => JSON.stringify(candidate) === JSON.stringify(seen),
          );
          assert.equal(
            matched,
            true,
            `读到的值不是任何一次写入的完整快照(疑似部分写入/字段混合): ${JSON.stringify(seen)}`,
          );
        }
      });
    });

    it("并发写入后最终态是一个完整值,且后续读取稳定", async () => {
      const writes: JsonObject[] = Array.from({ length: 12 }, (_, i) => ({ v: i }));
      await withTarget(factory, async (ws) => {
        await Promise.all(
          writes.map((v) => ws.user.writeJson("final.json", v, { merge: false })),
        );
        const a = await ws.user.readJson("final.json");
        const b = await ws.user.readJson("final.json");
        assert.deepEqual(a, b, "静止后两次读取必须一致");
        assert.equal(
          writes.some((w) => JSON.stringify(w) === JSON.stringify(a)),
          true,
          "最终态必须是某一次写入的完整值",
        );
      });
    });
  });
}

/**
 * 断言 `fn` 抛出带指定判别码的错误,**且**错误文本指名 `mentions` 这个既有键。
 *
 * Req 1.7 要求错误「说明与哪个既有键冲突」——只断言判别码的话,一个把 `reason` 写成
 * 「冲突」二字的实现同样绿,而排障者拿不到任何可行动的信息。
 */
async function assertRejectsWithCodeMentioning(
  fn: () => Promise<unknown>,
  expected: WorkspaceErrorCode,
  mentions: string,
  message: string,
): Promise<void> {
  let caught: unknown;
  let threw = false;
  try {
    await fn();
  } catch (err) {
    threw = true;
    caught = err;
  }
  assert.equal(threw, true, `${message}: expected to reject, but it resolved`);
  const actual = codeOf(caught);
  assert.equal(actual, expected, `${message}: expected code ${expected}, got ${String(actual)}`);
  // ⚠ 只看 `reason`,**不看**整条 message:message 里含被写入的键本身,而正向冲突中冲突键
  // (`g/a.json`)恰是被写键(`g/a.json/x.json`)的子串——拿 message 判定就成了恒真断言。
  // `reason` 是契约定义的字段(§3.6,勘误⑧ 明确「冲突说明由 reason 承载」),故按它判。
  const reasonRaw = (caught as { reason?: unknown } | undefined)?.reason;
  const reason = typeof reasonRaw === "string" ? reasonRaw : "";
  assert.equal(
    reason.includes(mentions),
    true,
    `${message}: WorkspaceKeyError.reason 须指名冲突的既有键 ${JSON.stringify(mentions)},实际 reason 为 ${JSON.stringify(reason)}`,
  );
}

/**
 * 「值与分组不可同址」用例组(Req 1.7/1.8,契约 §3.2 第 6 条 / 勘误⑧)。
 *
 * 为什么这是**契约**而不是实现差异:层级载体(文件系统)上 `g/a.json` 一旦是文件,其下
 * 就放不下 `g/a.json/x.json`;扁平 KV 载体上两者却能并存。不把它定为键空间约束,就等于
 * 承认「同一份配置搬到另一端会炸」是合法状态 —— 而消灭这种状态正是本契约存在的理由。
 * 故两种载体**都**必须主动探测并拒绝,不能靠层级载体碰巧报 errno。
 */
function collocationCases(runner: SuiteRunner, factory: ConformanceFactory): void {
  const { describe, it } = runner;

  describe("值与分组不可同址(Req 1.7/1.8)", () => {
    it("① 键的严格前缀已是值键 → 写入抛 key,且指名冲突键(Req 1.7)", async () => {
      await withTarget(factory, async (ws) => {
        await ws.user.writeJson("g/a.json", SAMPLE);
        await assertRejectsWithCodeMentioning(
          () => ws.user.writeJson("g/a.json/x.json", SAMPLE),
          "key",
          "g/a.json",
          "前缀已是值键",
        );
        // 被拒的写入不得留下任何痕迹:既有值键必须完好。
        assert.deepEqual(await ws.user.readJson("g/a.json"), SAMPLE);
        assert.equal(await ws.user.exists("g/a.json/x.json"), false);
      });
    });

    it("② 键本身是某既有值键的严格前缀 → 写入抛 key,且指名冲突键(Req 1.7)", async () => {
      await withTarget(factory, async (ws) => {
        await ws.user.writeJson("g/a.json/x.json", SAMPLE);
        await assertRejectsWithCodeMentioning(
          () => ws.user.writeJson("g/a.json", SAMPLE),
          "key",
          "g/a.json/x.json",
          "键是既有值键的严格前缀",
        );
        assert.deepEqual(await ws.user.readJson("g/a.json/x.json"), SAMPLE);
      });
    });

    it("③ 读一个只是分组前缀的键 → 返回空对象,**不得**抛错(Req 1.8)", async () => {
      // ① / ② 保证分组永不是值键,故读分组就是读一个不存在的键 ⇒ 按 Req 2.1 读为 `{}`。
      // 层级载体上这条尤其容易违反:`readFile` 一个目录会给 `EISDIR`,顺手包成 IO 错误
      // 就与扁平 KV 后端(返回 `{}`)对不齐 —— 正是本契约要消灭的两端分歧。
      await withTarget(factory, async (ws) => {
        await ws.user.writeJson("g/deep/leaf.json", SAMPLE);
        assert.deepEqual(await ws.user.readJson("g"), {}, "读分组前缀 g 须为空对象");
        assert.deepEqual(
          await ws.user.readJson("g/deep"),
          {},
          "读更深一层的分组前缀 g/deep 须为空对象",
        );
        // 与 exists / list 的口径必须一致:同一个键不得给出互斥答案。
        assert.equal(await ws.user.exists("g"), false);
      });
    });
  });
}

/** 键空间用例组(Req 1.1-1.6 / 8.2)。 */
function keySpaceCases(runner: SuiteRunner, factory: ConformanceFactory): void {
  const { describe, it } = runner;

  describe("键空间规则(安全边界,Req 1.1-1.6)", () => {
    for (const ns of NAMESPACES) {
      for (const { key, why } of INVALID_KEYS) {
        it(`[${ns}] 拒绝非法键 ${JSON.stringify(key)}(${why})— 全部五个方法`, async () => {
          await withTarget(factory, async (ws) => {
            const n = nsOf(ws, ns);
            const label = `[${ns}] ${JSON.stringify(key)}`;
            // 五个方法逐一校验:任一方法漏校验即为穿越入口。
            await assertRejectsWithCode(() => n.readJson(key), "key", `${label} readJson`);
            await assertRejectsWithCode(
              () => n.writeJson(key, SAMPLE),
              "key",
              `${label} writeJson`,
            );
            await assertRejectsWithCode(() => n.list(key), "key", `${label} list`);
            await assertRejectsWithCode(() => n.delete(key), "key", `${label} delete`);
            await assertRejectsWithCode(() => n.exists(key), "key", `${label} exists`);
          });
        });
      }

      it(`[${ns}] 接受合法的单段与多段相对键(Req 1.6)`, async () => {
        await withTarget(factory, async (ws) => {
          const n = nsOf(ws, ns);
          for (const key of VALID_KEYS) {
            await n.writeJson(key, SAMPLE);
            assert.deepEqual(
              await n.readJson(key),
              SAMPLE,
              `[${ns}] 合法键 ${key} 应可写可读`,
            );
          }
        });
      });

      it(`[${ns}] 键大小写敏感,不做归一化(Req 1.5;不敏感载体须显式声明)`, async () => {
        // 契约 §3.2 第 4 条 / 勘误⑦:大小写敏感是**键空间的契约语义**,但载体可能承载不了
        // —— macOS/Windows 默认文件系统上 `Case.json` 与 `case.json` 是物理同一个文件,
        // 实现**原理上无法**满足。故实现可经 `ConformanceTarget.caseSensitiveKeys: false`
        // 声明该限制。
        //
        // ★ 声明**不是**豁免:声明后本用例改为断言「两键确实互为别名」——一个声称不敏感
        // 却实际敏感的实现同样会红。这使声明本身可被证伪,而不是一个能把红改绿的开关。
        await withRawTarget(factory, async (t) => {
          const n = nsOf(t.workspace, ns);
          await n.writeJson("cs/Case.json", { which: "upper" }, { merge: false });
          await n.writeJson("cs/case.json", { which: "lower" }, { merge: false });
          // ⚠ 本用例只验**大小写维度**,故列举结果先归一化排序再比对:直接比对 `list` 的
          // 原序会把「排序口径」耦合进来,一个排序写错的实现会在这里报「大小写不敏感」,
          // 指向完全错误的方向。排序另有专门用例(见读写语义组)。
          const listed = [...(await n.list("cs"))].sort();

          if (t.caseSensitiveKeys ?? true) {
            assert.deepEqual(await n.readJson("cs/Case.json"), { which: "upper" });
            assert.deepEqual(await n.readJson("cs/case.json"), { which: "lower" });
            assert.deepEqual(
              listed,
              ["cs/Case.json", "cs/case.json"],
              `[${ns}] 大小写敏感载体上两键是两个键,列举应各出现一次`,
            );
            return;
          }
          // 已声明不敏感:两键必须**确实**塌成一个,且后写者胜出。
          assert.deepEqual(await n.readJson("cs/Case.json"), { which: "lower" });
          assert.deepEqual(await n.readJson("cs/case.json"), { which: "lower" });
          assert.equal(
            listed.length,
            1,
            `[${ns}] 已声明大小写不敏感,两键须塌为一个键;实际列举到 ${JSON.stringify(listed)}`,
          );
        });
      });
    }
  });
}

/**
 * 对某个 {@link Workspace} 实现执行契约一致性套件。
 *
 * @param runner 调用方提供的 `describe`/`it`(套件自身不 import 测试框架)。
 * @param name   被测实现名,进入用例标题以便区分多个实现。
 * @param factory 被测实例工厂;每次调用须产出**相互隔离**的实例。
 */
export function runWorkspaceConformance(
  runner: SuiteRunner,
  name: string,
  factory: ConformanceFactory,
): void {
  runner.describe(`Workspace 契约一致性 · ${name}`, () => {
    keySpaceCases(runner, factory);
    collocationCases(runner, factory);
    readWriteCases(runner, factory);
    limitAndConcurrencyCases(runner, factory);
  });
}

/** 供 3.2/3.3 与自检使用的内部导出(不属对外契约面)。 */
export const __conformanceInternals = {
  INVALID_KEYS,
  VALID_KEYS,
  NAMESPACES,
} as const;

export type { WorkspaceKey };

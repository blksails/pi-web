/**
 * 键空间校验(spec: host-contract-ports,任务 2.1;Req 1.1-1.6)。
 *
 * 权威依据:`docs/pi-web-host-contract-v1.md` §3.2。
 *
 * ⚠ **这是安全边界,不是便利检查。** 本地实现把键直接映射为真实文件路径,任何校验疏漏
 * 即为路径穿越漏洞。故:
 *  - 校验必须在**触及任何存储之前**执行(Req 1.1);
 *  - 各实现**不得放宽**本规则(契约 §7.3);
 *  - 用例须**穷举**非法形态,而非抽样。
 *
 * 校验通过后,实现层仍须用 `path.join` 而非字符串拼接——纵深防御,不因本层存在而省略。
 *
 * 纯函数:不读 env / fs;同输入恒同输出。pi-SDK-free。
 */
import { WorkspaceKeyError, type WorkspaceKey } from "./types.js";

/** 段分隔符。键是 `/` 分隔的相对路径(与平台无关,不用 `path.sep`)。 */
const SEPARATOR = "/";

/**
 * 校验键是否满足键空间规则;不满足即抛 {@link WorkspaceKeyError}。
 *
 * 合法:以 `/` 连接的一到多段相对路径,如 `settings.json`、`sources/<key>/settings.json`。
 *
 * 非法(Req 1.1-1.4):
 *  - 空串
 *  - 绝对路径(前导 `/`)
 *  - `.` 或 `..` 段
 *  - 空段(连续 `//`、尾随 `/`)
 *  - 反斜杠 `\`(Windows 路径分隔符;放行会在该平台造成第二条穿越通道)
 *  - 空字符 `\0`(可截断底层系统调用的路径)
 *
 * 键**大小写敏感**(Req 1.5):本函数不做任何大小写归一化。运行在大小写不敏感文件系统上的
 * 实现须自行保证不同大小写的键不产生别名冲突。
 */
export function validateWorkspaceKey(key: WorkspaceKey): void {
  if (typeof key !== "string" || key.length === 0) {
    throw new WorkspaceKeyError(String(key), "key must be a non-empty string");
  }
  if (key.includes("\0")) {
    throw new WorkspaceKeyError(key, "key must not contain a NUL character");
  }
  if (key.includes("\\")) {
    throw new WorkspaceKeyError(key, "key must not contain a backslash");
  }
  if (key.startsWith(SEPARATOR)) {
    throw new WorkspaceKeyError(key, "key must be relative, not absolute");
  }

  const segments = key.split(SEPARATOR);
  for (const segment of segments) {
    if (segment.length === 0) {
      // 覆盖三种形态:连续 `//`、尾随 `/`(末段为空)。前导 `/` 已由上面的绝对路径分支拦下,
      // 此处仍能兜住(顺序改变也不失效)。
      throw new WorkspaceKeyError(key, "key must not contain an empty segment");
    }
    if (segment === "." || segment === "..") {
      throw new WorkspaceKeyError(
        key,
        `key must not contain a relative segment ${JSON.stringify(segment)}`,
      );
    }
  }
}

/** 校验并原样返回,便于在表达式位置使用。 */
export function assertWorkspaceKey(key: WorkspaceKey): WorkspaceKey {
  validateWorkspaceKey(key);
  return key;
}

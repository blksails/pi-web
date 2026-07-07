/**
 * 桌面壳:启动失败可见呈现(spec pi-web-desktop task 2.5,Req 2.1/2.2/2.3/2.4)。
 *
 * - describeStartupError:纯函数,把判别式启动错误映射为可读标题+详情(可单测)。
 * - showStartupError:electron 层,用系统对话框呈现并给「重试 / 退出」两途径(Req 2.4)。
 */
import { dialog } from "electron";
import type { ServerStartError } from "./server-supervisor.js";

export interface StartupErrorText {
  readonly title: string;
  readonly detail: string;
}

/** 三类启动错误 → 可读文案。纯函数,不依赖 electron。 */
export function describeStartupError(error: ServerStartError): StartupErrorText {
  switch (error.kind) {
    case "no-free-port":
      return {
        title: "无法启动:端口不可用",
        detail:
          `本地服务器找不到可用端口(从 ${error.triedFrom} 起的一段范围均被占用)。\n` +
          `请关闭占用端口的程序后重试。`,
      };
    case "early-exit": {
      const codePart = error.code === null ? "未知退出码" : `退出码 ${error.code}`;
      const tail = error.stderrTail.trim();
      const tailPart = tail.length > 0 ? `\n\n错误输出:\n${tail}` : "";
      return {
        title: "本地服务器启动失败",
        detail: `本地服务器在就绪前退出(${codePart})。${tailPart}`,
      };
    }
    case "ready-timeout":
      return {
        title: "启动超时",
        detail:
          `本地服务器在 ${Math.round(error.timeoutMs / 1000)} 秒(${error.timeoutMs}ms)内未就绪。\n` +
          `请重试;若反复超时,可能是本机资源紧张或产物损坏。`,
      };
  }
}

export interface StartupErrorActions {
  readonly onRetry: () => void;
  readonly onQuit: () => void;
}

/**
 * 用系统错误对话框呈现启动失败,并提供「重试 / 退出」(Req 2.4)。
 * 默认按钮=重试,取消=退出;两途径确保不停在空白或无限等待。
 */
export async function showStartupError(
  error: ServerStartError,
  actions: StartupErrorActions,
): Promise<void> {
  const { title, detail } = describeStartupError(error);
  const { response } = await dialog.showMessageBox({
    type: "error",
    title,
    message: title,
    detail,
    buttons: ["重试", "退出"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  });
  if (response === 0) actions.onRetry();
  else actions.onQuit();
}

/**
 * cn — className 合并工具(clsx + tailwind-merge)。
 *
 * 供所有组件复用,以便宿主用 Tailwind 工具类覆盖样式而不产生冲突。
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: readonly ClassValue[]): string {
  return twMerge(clsx(inputs));
}

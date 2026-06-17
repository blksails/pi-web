/**
 * useAttachments — 待发送图片附件状态(来源无关:拖拽/粘贴/选择)。
 *
 * 仅接受图片类型(`image/*`),非图片记入返回的 `rejected` 并提示(Req 3.4)。
 * 维护内存态列表(`PendingAttachment`),提供 remove/clear 与 toImageContents 输出。
 * 当会话/agent 不支持图片输入时由上层经 options 置 supported=false(Req 3.5):此时
 * add 不入列,全部文件记入 rejected。
 *
 * 不变量:仅 `image/*` 进入 items;`toImageContents` 产出的 `data` 为裸 base64
 * (无 data URL 前缀),对齐 `@pi-web/protocol` 的 ImageContent schema
 * ({ type: "image", data: string, mimeType: string })。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ImageContent } from "@pi-web/protocol";

export interface PendingAttachment {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  /** 完整 data URL(`data:<mime>;base64,<...>`),用于缩略图展示。 */
  readonly dataUrl: string;
}

export interface UseAttachmentsOptions {
  /** 当前会话/agent 是否支持图片输入;默认 true。由上层依据能力决定。 */
  readonly supported?: boolean;
}

export interface UseAttachmentsResult {
  readonly items: ReadonlyArray<PendingAttachment>;
  /** 当前会话/agent 是否支持图片输入。 */
  readonly supported: boolean;
  /** 仅 `image/*` 进入 items;非图片(或 supported=false 时全部)文件名进 rejected。 */
  add(files: FileList | File[]): Promise<{ rejected: string[] }>;
  remove(id: string): void;
  clear(): void;
  /** 把 items 映射为 pi 的 ImageContent[](data 为裸 base64)。 */
  toImageContents(): ImageContent[];
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

/** 用 FileReader 把 File 读为 data URL(`data:<mime>;base64,<...>`)。 */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") {
        resolve(result);
      } else {
        reject(new Error("useAttachments: FileReader did not return a string"));
      }
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error("useAttachments: FileReader failed"));
    };
    reader.readAsDataURL(file);
  });
}

/** 从 data URL 提取裸 base64 负载(去除 `data:<mime>;base64,` 前缀)。 */
function base64FromDataUrl(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

function toFileArray(files: FileList | File[]): File[] {
  return Array.isArray(files) ? files : Array.from(files);
}

export function useAttachments(
  opts: UseAttachmentsOptions = {},
): UseAttachmentsResult {
  const supported = opts.supported ?? true;

  const [items, setItems] = useState<ReadonlyArray<PendingAttachment>>([]);
  const idSeq = useRef(0);

  const nextId = useCallback((): string => {
    idSeq.current += 1;
    return `att-${idSeq.current}`;
  }, []);

  const add = useCallback(
    async (files: FileList | File[]): Promise<{ rejected: string[] }> => {
      const list = toFileArray(files);
      // 不支持图片输入时:不入列,全部记为 rejected(Req 3.5)。
      if (!supported) {
        return { rejected: list.map((f) => f.name) };
      }

      const rejected: string[] = [];
      const accepted: File[] = [];
      for (const file of list) {
        if (isImage(file)) {
          accepted.push(file);
        } else {
          rejected.push(file.name);
        }
      }

      const additions = await Promise.all(
        accepted.map(async (file): Promise<PendingAttachment> => {
          const dataUrl = await readAsDataUrl(file);
          return {
            id: nextId(),
            name: file.name,
            mimeType: file.type,
            dataUrl,
          };
        }),
      );

      if (additions.length > 0) {
        setItems((prev) => [...prev, ...additions]);
      }
      return { rejected };
    },
    [supported, nextId],
  );

  const remove = useCallback((id: string): void => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }, []);

  const clear = useCallback((): void => {
    setItems([]);
  }, []);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const toImageContents = useCallback((): ImageContent[] => {
    return itemsRef.current.map((it) => ({
      type: "image",
      data: base64FromDataUrl(it.dataUrl),
      mimeType: it.mimeType,
    }));
  }, []);

  return useMemo(
    () => ({ items, supported, add, remove, clear, toImageContents }),
    [items, supported, add, remove, clear, toImageContents],
  );
}

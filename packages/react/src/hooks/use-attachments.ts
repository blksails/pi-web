/**
 * useAttachments — 待发送图片附件状态(来源无关:拖拽/粘贴/选择)。
 *
 * 仅接受图片类型(`image/*`),非图片记入返回的 `rejected` 并提示(Req 3.4)。
 * 维护内存态列表(`PendingAttachment`),提供 remove/clear 与 toImageContents 输出。
 * 当会话/agent 不支持图片输入时由上层经 options 置 supported=false(Req 3.5):此时
 * add 不入列,全部文件记入 rejected。
 *
 * 上传摄入(Req 5.1/5.4/5.5/5.6/2.4):`add()` 异步——先以本地预览 dataUrl 入列并置
 * `status="uploading"`,再调用注入的上传函数(默认 `uploadAttachment`)向会话上传端点落库;
 * 成功置 `status="ready"` 并记 server 返回的正式公开 id(`attachmentId`)与展示 URL
 * (`displayUrl`),失败置 `status="error"`。仅 `status="ready"` 且带 server 铸造的
 * `attachmentId` 才视为可提交的已落库引用(`referenceIds()`);前端不自造正式 id。
 *
 * 不变量:仅 `image/*` 进入 items;`toImageContents` 产出的 `data` 为裸 base64
 * (无 data URL 前缀),对齐 `@pi-web/protocol` 的 ImageContent schema
 * ({ type: "image", data: string, mimeType: string })。vision 维持现状:发图仍走
 * base64(`toImageContents()`),不内联进列表项展示。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { ImageContent, UploadAttachmentResponse } from "@pi-web/protocol";
import { uploadAttachment as defaultUploadAttachment } from "../transport/attachment-upload.js";
import { joinUrl } from "../client/request.js";

/** 待提交附件的上传状态机。 */
export type PendingAttachmentStatus = "uploading" | "ready" | "error";

export interface PendingAttachment {
  /** 本地行 key(稳定,贯穿状态机;非 server 铸造的正式 id)。 */
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  /** 完整 data URL(`data:<mime>;base64,<...>`),用于上传前本地预览缩略图。 */
  readonly dataUrl: string;
  /**
   * 上传状态:uploading(进行中)/ ready(已落库)/ error(失败)。
   * hook 产出的 items 必带此字段;声明为可选仅为对既有调用方(在自造 PendingAttachment
   * 字面量时尚未带 status)向后兼容(Req 5.4)。
   */
  readonly status?: PendingAttachmentStatus;
  /** server 铸造的正式公开 id(`att_<nanoid>`);仅 status="ready" 时存在(Req 2.4/5.6)。 */
  readonly attachmentId?: string;
  /** 分发展示 URL(server 返回);仅 status="ready" 时存在(Req 5.2)。 */
  readonly displayUrl?: string;
}

/**
 * 上传函数签名:向会话上传端点落库并回传正式描述符。
 * 默认实现为 transport 的 `uploadAttachment`;测试可注入 mock。
 */
export type UploadAttachmentFn = (
  baseUrl: string,
  sessionId: string,
  file: File,
) => Promise<UploadAttachmentResponse>;

export interface UseAttachmentsOptions {
  /** 当前会话/agent 是否支持图片输入;默认 true。由上层依据能力决定。 */
  readonly supported?: boolean;
  /** http-api 基址(如 `/api`),传给上传函数。上传所需,缺省为 ""。 */
  readonly baseUrl?: string;
  /** 目标会话 id(上传写路径门控落在 `:id`)。上传所需,缺省为 ""。 */
  readonly sessionId?: string;
  /** 可注入的上传函数(默认 `uploadAttachment`);测试用以 mock。 */
  readonly upload?: UploadAttachmentFn;
}

export interface UseAttachmentsResult {
  readonly items: ReadonlyArray<PendingAttachment>;
  /** 当前会话/agent 是否支持图片输入。 */
  readonly supported: boolean;
  /**
   * 仅 `image/*` 进入 items(以 uploading 态入列并异步上传);非图片(或 supported=false
   * 时全部)文件名进 rejected。Promise 在「入列 + 触发上传」后即 resolve,状态机后续
   * 经 setItems 推进至 ready/error。
   */
  add(files: FileList | File[]): Promise<{ rejected: string[] }>;
  remove(id: string): void;
  clear(): void;
  /** 把 items 映射为 pi 的 ImageContent[](data 为裸 base64)。 */
  toImageContents(): ImageContent[];
  /**
   * 仅 status="ready" 且带 server 铸造 attachmentId 的可提交已落库引用 id(Req 5.3/5.6)。
   * hook 始终提供此实现;声明为可选仅为对既有 UseAttachmentsResult 结构 mock(尚未带
   * referenceIds 的调用方)向后兼容,由下游提交链路任务正式接入。
   */
  referenceIds?(): string[];
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

/**
 * 把 server 返回的展示 URL 解析为前端可达 URL。
 * server 回传的是「根相对」路径(如 `/attachments/:id/raw?exp&sig`);需用 hook 的
 * baseUrl(如 `/api`)前缀为 `/api/attachments/:id/raw?exp&sig`,否则前端走根路径 404。
 * 仅当 displayUrl 是根相对(以 `/` 开头且非 http(s))时前缀 baseUrl;已是绝对 http(s)
 * 则原样返回。baseUrl 仅作展示前缀,不进 HMAC 签名输入(签名只覆盖裸 id,校验侧解析
 * `/attachments/:attachmentId/raw` 拿裸 id,前缀不影响校验)。
 */
function resolveDisplayUrl(baseUrl: string, displayUrl: string): string {
  if (/^https?:\/\//i.test(displayUrl)) return displayUrl;
  if (!displayUrl.startsWith("/")) return displayUrl;
  if (baseUrl === "") return displayUrl;
  return joinUrl(baseUrl, displayUrl);
}

export function useAttachments(
  opts: UseAttachmentsOptions = {},
): UseAttachmentsResult {
  const supported = opts.supported ?? true;
  const baseUrl = opts.baseUrl ?? "";
  const sessionId = opts.sessionId ?? "";
  const upload = opts.upload ?? defaultUploadAttachment;

  const [items, setItems] = useState<ReadonlyArray<PendingAttachment>>([]);
  const idSeq = useRef(0);

  // 把上传依赖 pin 到 ref,避免 add 的 useCallback 因 baseUrl/sessionId/upload
  // 变化而重建 identity(状态机经闭包内 ref 读取最新值)。
  const baseUrlRef = useRef(baseUrl);
  baseUrlRef.current = baseUrl;
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const uploadRef = useRef(upload);
  uploadRef.current = upload;

  const nextId = useCallback((): string => {
    idSeq.current += 1;
    return `att-${idSeq.current}`;
  }, []);

  /** 落库成功:置 ready 并记 server 铸造的正式 id 与展示 URL(按本地行 key 定位)。 */
  const markReady = useCallback(
    (localId: string, res: UploadAttachmentResponse): void => {
      setItems((prev) =>
        prev.map((it) =>
          it.id === localId
            ? {
                ...it,
                status: "ready",
                attachmentId: res.attachment.id,
                // 展示侧把根相对 displayUrl 用 baseUrl 解析为可达 URL(如 /api/...)。
                displayUrl: resolveDisplayUrl(baseUrlRef.current, res.displayUrl),
              }
            : it,
        ),
      );
    },
    [],
  );

  /** 落库失败:置 error 且不赋正式 id(不计入可提交引用)。 */
  const markError = useCallback((localId: string): void => {
    setItems((prev) =>
      prev.map((it) =>
        it.id === localId ? { ...it, status: "error" } : it,
      ),
    );
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

      // 先读本地预览 dataUrl,以 uploading 态入列(Req 5.4),并记录待上传 File。
      const additions = await Promise.all(
        accepted.map(
          async (
            file,
          ): Promise<{ entry: PendingAttachment; file: File }> => {
            const dataUrl = await readAsDataUrl(file);
            const entry: PendingAttachment = {
              id: nextId(),
              name: file.name,
              mimeType: file.type,
              dataUrl,
              status: "uploading",
            };
            return { entry, file };
          },
        ),
      );

      if (additions.length > 0) {
        setItems((prev) => [...prev, ...additions.map((a) => a.entry)]);
        // 触发上传:成功置 ready+正式 id/展示 URL,失败置 error(Req 5.1/5.5/5.6/2.4)。
        // 正式 id 仅来自 server 返回,前端不自造。
        for (const { entry, file } of additions) {
          void uploadRef
            .current(baseUrlRef.current, sessionIdRef.current, file)
            .then(
              (res) => markReady(entry.id, res),
              () => markError(entry.id),
            );
        }
      }
      return { rejected };
    },
    [supported, nextId, markReady, markError],
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

  const referenceIds = useCallback((): string[] => {
    const ids: string[] = [];
    for (const it of itemsRef.current) {
      // 仅 ready + server 铸造的 attachmentId 视为可提交的已落库引用(Req 5.3/5.6)。
      if (it.status === "ready" && it.attachmentId != null) {
        ids.push(it.attachmentId);
      }
    }
    return ids;
  }, []);

  return useMemo(
    () => ({
      items,
      supported,
      add,
      remove,
      clear,
      toImageContents,
      referenceIds,
    }),
    [items, supported, add, remove, clear, toImageContents, referenceIds],
  );
}

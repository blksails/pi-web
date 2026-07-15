/**
 * archive-tools — 结果与错误码（可序列化进 tool content）。
 */

export type ArchiveErrorCode =
  | "PATH_ESCAPE"
  | "NOT_FOUND"
  | "INVALID_ARCHIVE"
  | "RAR_BACKEND_UNAVAILABLE"
  | "IO_ERROR"
  | "INVALID_ARGUMENT";

export type ArchiveOk<T extends Record<string, unknown> = Record<string, unknown>> = {
  readonly ok: true;
} & T;

export type ArchiveErr = {
  readonly ok: false;
  readonly code: ArchiveErrorCode;
  readonly message: string;
};

export type ArchiveResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ArchiveOk<T>
  | ArchiveErr;

export interface ZipEntryMeta {
  readonly name: string;
  readonly size: number;
  readonly method: number;
  readonly compressedSize: number;
  readonly crc32: number;
  /** 本地头偏移（相对文件起始）。 */
  readonly localHeaderOffset: number;
}

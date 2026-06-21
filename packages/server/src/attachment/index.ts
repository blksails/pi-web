/**
 * attachment-store · 模块公共出口(barrel)。
 *
 * 随波次推进逐步补齐:本切片首批仅导出公开 id 铸造工具;
 * 后续任务在此追加 BlobStore / LocalFsBlobBackend / AttachmentRegistry /
 * UrlSigner / AttachmentStore / attachmentStoreConfigFromEnv 等复用面导出。
 */
export { mintAttachmentId } from "./id.js";
export {
  createUrlSigner,
  resolveAttachmentSecret,
  ATTACHMENT_SECRET_ENV,
  type UrlSigner,
} from "./url-signer.js";
export {
  BlobNotFoundError,
  type BlobStore,
  type BlobMeta,
} from "./blob-store.js";
export { LocalFsBlobBackend } from "./local-fs-backend.js";
export { AttachmentRegistry } from "./attachment-registry.js";
export {
  AttachmentStore,
  type PutInput,
  type AttachmentStoreDeps,
} from "./attachment-store.js";

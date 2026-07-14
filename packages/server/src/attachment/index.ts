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
  type PutOptions,
  type PutReceipt,
} from "./blob-store.js";
export { LocalFsBlobBackend } from "./local-fs-backend.js";
export {
  LocalFsAttachmentRegistry,
  LocalFsAttachmentRegistry as AttachmentRegistry,
  AttachmentDescriptorNotFoundError,
  type AttachmentRegistryPort,
} from "./attachment-registry.js";
export {
  AttachmentStore,
  type PutInput,
  type AttachmentStoreDeps,
} from "./attachment-store.js";
export {
  attachmentStoreConfigFromEnv,
  resolveAttachmentDir,
  defaultAttachmentDir,
  ATTACHMENT_DIR_ENV,
  type AttachmentStoreConfig,
} from "./config.js";
export {
  UnionBlobStore,
  UnknownBackendBindingError,
  type NamedBackend,
  type WritePolicy,
  type UnionBlobStoreDeps,
} from "./union-blob-store.js";
export { S3Client, S3NotFoundError, S3RequestError, type S3ClientConfig } from "./s3/s3-client.js";
export { S3BlobBackend, type S3BlobBackendConfig } from "./s3/s3-blob-backend.js";
export { S3AttachmentRegistry, type S3AttachmentRegistryConfig } from "./s3/s3-registry.js";
export {
  HttpBlobStore,
  type HttpBlobStoreConfig,
  HttpAttachmentRegistry,
  type HttpAttachmentRegistryConfig,
  RemoteAttachmentError,
} from "./http/index.js";
export {
  ATTACHMENT_BACKENDS_ENV,
  ATTACHMENT_PROFILE_DISABLED_ENV,
  AttachmentBackendsConfigError,
  isAttachmentProfileDisabled,
  parseBackendsEnv,
  buildBackends,
  buildRegistry,
  computePassthroughEnv,
  type BackendDecl,
  type LocalFsBackendDecl,
  type S3BackendDecl,
  type CloudHttpBackendDecl,
  type RegistryDecl,
  type BackendsTopology,
  type BuildDeps,
} from "./backends-config.js";

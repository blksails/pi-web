/**
 * attachment · `cloud-http` 后端族(`HttpBlobStore`/`HttpAttachmentRegistry`)共用的远端错误
 * (`sandbox-attachment-store` spec Wave A'，design §7.1)。
 *
 * HTTP 非 2xx(未被更具体地映射为 {@link ../blob-store.js!BlobNotFoundError} /
 * {@link ../attachment-registry.js!AttachmentDescriptorNotFoundError} 的场景)或网络层失败
 * (连接被拒、超时等)统一抛出本错误，携带可选 `status`（HTTP 状态码；网络失败时缺省）供上层
 * 诊断，`message` 不包含请求携带的凭据 token。
 */
export class RemoteAttachmentError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "RemoteAttachmentError";
  }
}

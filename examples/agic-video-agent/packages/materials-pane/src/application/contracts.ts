export type MaterialKind = "image" | "video" | "audio";

export interface MaterialsLibraryItem {
  readonly assetId: string;
  readonly displayUrl: string;
  readonly createdAt: string;
  readonly meta: {
    readonly materialId: string;
    readonly name?: string;
    readonly type?: string;
    readonly fileUrl?: string;
    readonly folderId?: string;
    readonly libraryAssetId?: string;
    readonly origin?: "aigc" | "webapp_ref";
    readonly accounts?: unknown;
  };
}

/** 当前用户、当前会话已使用素材轨；数据源为 pi-labs.aigc_assets。 */
export interface MaterialsSessionLibraryQuery {
  readonly kind: "library";
  readonly page?: number;
  readonly pageSize?: number;
  readonly materialKind?: MaterialKind;
}

export interface MaterialsSearchQuery {
  readonly kind: "search";
  readonly page?: number;
  readonly pageSize?: number;
  readonly materialKind?: MaterialKind;
  readonly folderId?: string;
  readonly includeSub?: boolean;
  readonly search?: string;
}

export interface MaterialsGetQuery {
  readonly kind: "get";
  readonly ids: readonly string[];
}

export interface MaterialsStatusQuery {
  readonly kind: "status";
  readonly ids: readonly string[];
}

export interface MaterialsLocateQuery {
  readonly kind: "locate";
  readonly id: string;
}

export type MaterialsQuery =
  | MaterialsSessionLibraryQuery
  | MaterialsSearchQuery
  | MaterialsGetQuery
  | MaterialsStatusQuery
  | MaterialsLocateQuery;

export interface MaterialsWriteGuard {
  readonly confirmed: true;
  readonly idempotencyKey: string;
}

export type MaterialsCommand =
  | {
      readonly kind: "add-to-library";
      readonly ids: readonly string[];
    }
  | {
      readonly kind: "create-folder";
      readonly name: string;
      readonly parentId: string | null;
    }
  | {
      readonly kind: "rename-folder";
      readonly id: string;
      readonly name: string;
    }
  | ({
      readonly kind: "delete-folder";
      readonly id: string;
    } & MaterialsWriteGuard)
  | ({
      readonly kind: "move-materials";
      readonly ids: readonly string[];
      readonly folderId: string | null;
    } & MaterialsWriteGuard)
  | {
      readonly kind: "rename-materials";
      readonly items: readonly { readonly id: string; readonly name: string }[];
      readonly confirmed?: true;
      readonly idempotencyKey?: string;
    }
  | ({
      readonly kind: "delete-materials";
      readonly ids: readonly string[];
    } & MaterialsWriteGuard)
  | ({
      readonly kind: "distribute";
      readonly ids: readonly string[];
      readonly advertiserIds: readonly string[];
    } & MaterialsWriteGuard);

export type MaterialsErrorCode =
  | "invalid_request"
  | "invalid_authorization"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "confirmation_required"
  | "idempotency_key_required"
  | "idempotency_conflict"
  | "untrusted_webapp_origin"
  | "invalid_webapp_url"
  | "invalid_webapp_response"
  | "platform_unavailable"
  | "folders_list_failed"
  | "materials_request_failed"
  | "webapp_unavailable";

export class MaterialsApplicationError extends Error {
  constructor(
    readonly code: MaterialsErrorCode,
    message: string,
    readonly status: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "MaterialsApplicationError";
  }
}

export interface MaterialsAuditRecord {
  readonly at: string;
  readonly requestId: string;
  readonly operation: MaterialsCommand["kind"];
  readonly outcome: "success" | "failure";
  readonly entityIds: readonly string[];
  readonly count: number;
  readonly errorCode?: MaterialsErrorCode;
}

export interface MaterialsResultMeta {
  readonly requestId: string;
  readonly refresh: {
    readonly resource: "enterprise-materials";
    readonly strategy: "reload";
    readonly revision: number;
  };
}

export interface MaterialsApplicationService {
  query(query: MaterialsQuery): Promise<Record<string, unknown>>;
  execute(command: MaterialsCommand): Promise<Record<string, unknown> & MaterialsResultMeta>;
}

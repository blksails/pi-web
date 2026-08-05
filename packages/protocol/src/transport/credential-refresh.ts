/**
 * runner credential refresh frame.
 *
 * Host → runner only; credential is replaced in the runner process environment
 * so request-time agent routes use the current desktop identity.
 */
import { z } from "zod";

export const CredentialRefreshFrameSchema = z.object({
  type: z.literal("piweb_credential_refresh"),
  credential: z.string().min(1).nullable(),
});

export type CredentialRefreshFrame = z.infer<
  typeof CredentialRefreshFrameSchema
>;

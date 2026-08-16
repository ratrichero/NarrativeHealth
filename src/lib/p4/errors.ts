/**
 * P4 read service error contract (P4-05A).
 *
 * Failure isolation (P4-02 §10): any error surfaced by the service boundary is
 * converted to `null` by `getP4DecisionSupport` — a P4 failure must never
 * crash the narrative API or affect P3 data. These typed errors exist so the
 * boundary can classify failures during development/auditing without leaking
 * them to consumers.
 */

export type P4ServiceErrorCode =
  /** Persisted evidence could not be read (DB/load failure). */
  | "EVIDENCE_LOAD_FAILED"
  /** Evidence violates the P4-02 §7 identity contract. */
  | "IDENTITY_MISMATCH"
  /** No valid persisted evidence to assemble. */
  | "NO_EVIDENCE"
  /** Unexpected programming error inside the P4 read path. */
  | "INTERNAL";

export class P4ServiceError extends Error {
  readonly code: P4ServiceErrorCode;

  constructor(code: P4ServiceErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "P4ServiceError";
    this.code = code;
  }
}

export function p4LoadError(cause: unknown): P4ServiceError {
  return new P4ServiceError("EVIDENCE_LOAD_FAILED", "Failed to load persisted P4 evidence", { cause });
}

export function p4IdentityError(detail: string): P4ServiceError {
  return new P4ServiceError("IDENTITY_MISMATCH", `P4 identity validation failed: ${detail}`);
}

export function p4NoEvidenceError(detail: string): P4ServiceError {
  return new P4ServiceError("NO_EVIDENCE", detail);
}

export function p4InternalError(cause: unknown): P4ServiceError {
  return new P4ServiceError("INTERNAL", "Unexpected P4 read path error", { cause });
}

/**
 * Structured failure/observability codes for W3 failure-observability-contracts.
 * All codes are stable, additive-only, and machine-readable to ensure API/CLI parity
 * while preserving backward compatibility with existing human-readable output.
 */

/**
 * Sync operation state codes - stable machine-readable values for sync results.
 * Add new states only at the end; never reorder or change existing values.
 */
export const SYNC_STATES = {
  /** Content was changed and written successfully */
  CHANGED: 'changed',
  /** Content was unchanged (no-op, no write performed) */
  UNCHANGED: 'unchanged',
  /** Target was force-overwritten due to --force flag */
  FORCED_OVERWRITE: 'forced_overwrite',
  /** Rule was skipped due to non-conflict reason */
  SKIPPED: 'skipped',
  /** Rule was skipped due to unresolved BOTH_CHANGED conflict */
  SKIPPED_CONFLICT: 'skipped_conflict',
  /** Rule execution failed with an error */
  FAILED: 'failed',
}

/**
 * Lint/artifact read error codes - distinguish between different failure modes
 * when reading artifacts so consumers can differentiate absent vs corrupt vs unreadable.
 */
export const READ_ERROR_CODES = {
  /** Artifact exists and is valid but empty */
  VALID_EMPTY: 'R0001',
  /** Artifact does not exist at expected path */
  NOT_FOUND: 'R0002',
  /** Artifact exists but cannot be read due to permissions or IO error */
  UNREADABLE: 'R0003',
  /** Artifact exists and is readable but contains invalid/corrupt content */
  CORRUPT: 'R0004',
  /** Artifact path is outside expected root (path traversal attempt) */
  PATH_OUTSIDE_ROOT: 'R0005',
}

/**
 * Warning codes for non-fatal operational issues.
 */
export const WARNING_CODES = {
  /** Non-canonical artifact root detected (see W1 diagnostics) */
  NON_CANONICAL_ROOT: 'W1001',
  /** Mixed native/governance change roots present */
  MIXED_CHANGE_ROOTS: 'W1002',
  /** Legacy format artifact detected, will be migrated on next write */
  LEGACY_FORMAT: 'W2001',
  /** Unrecognized rule ID provided, skipped */
  UNKNOWN_RULE_ID: 'W2002',
  /** Plugin rule failed to load, skipped */
  PLUGIN_LOAD_FAILED: 'W2003',
  /** Sync skipped due to unresolved conflict */
  SYNC_CONFLICT_SKIPPED: 'W3001',
  /** Forced overwrite performed (conflict resolution via --force) */
  FORCED_OVERWRITE: 'W3002',
  /** File was unreadable and skipped during operation */
  UNREADABLE_FILE_SKIPPED: 'W3003',
}

/**
 * Error codes for fatal operational errors.
 */
export const ERROR_CODES = {
  /** Registry is corrupt and was quarantined */
  REGISTRY_CORRUPT: 'E0001',
  /** Registry schema version is newer than supported */
  REGISTRY_VERSION_MISMATCH: 'E0002',
  /** Could not acquire registry lock within timeout */
  REGISTRY_LOCKED: 'E0003',
  /** Interrupted sync pending and --no-recover specified */
  INTERRUPTED_SYNC_PENDING: 'E0004',
  /** Required artifact is missing for operation */
  REQUIRED_ARTIFACT_MISSING: 'E0005',
  /** Invalid configuration value provided */
  INVALID_CONFIG: 'E0006',
  /** Permission denied writing to artifact path */
  PERMISSION_DENIED: 'E0007',
}

/**
 * Attach structured code fields to a result/error object while preserving
 * existing fields for backward compatibility. Additive only - never removes
 * or overwrites existing properties.
 *
 * @param {object} target The result/error object to augment
 * @param {string} code The structured machine-readable code
 * @param {object} [extra] Additional structured fields to add
 * @returns {object} The augmented target object
 */
export function withStructuredCode(target, code, extra = {}) {
  return {
    ...target,
    code,
    ...extra,
  }
}

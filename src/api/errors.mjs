/**
 * Typed error classes for the SpecFuse programmatic API.
 *
 * All API functions throw subclasses of SpecFuseApiError instead of
 * calling process.exit or console.log. This allows consumers to catch
 * specific error types and handle them programmatically.
 */

/**
 * Base error class for all SpecFuse API errors.
 * All thrown errors from API modules are instances of this class or its subclasses.
 */
export class SpecFuseApiError extends Error {
  /**
   * @param {string} message - Human-readable error description
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'SpecFuseApiError'
  }
}

/**
 * Thrown when attempting to create an artifact that already exists
 * and cannot be silently overwritten (e.g., a duplicate active change).
 */
export class ArtifactAlreadyExistsError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ artifactType?: string, path?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'ArtifactAlreadyExistsError'
    this.artifactType = options.artifactType ?? null
    this.path = options.path ?? null
  }
}

/**
 * Thrown when a required artifact is not found.
 */
export class ArtifactNotFoundError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ artifactType?: string, name?: string, path?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'ArtifactNotFoundError'
    this.artifactType = options.artifactType ?? null
    this.name_ = options.name ?? null
    this.path = options.path ?? null
  }

  // Use name_ internally since Error.name is a getter/setter — expose as `artifactName`
  get artifactName() {
    return this.name_
  }
}

/**
 * Thrown when attempting to archive a change that has not passed verification
 * and force is not set.
 */
export class ChangeNotVerifiedError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ slug?: string, verifyStatus?: string, checked?: number, total?: number, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'ChangeNotVerifiedError'
    this.slug = options.slug ?? null
    this.verifyStatus = options.verifyStatus ?? null
    this.checked = options.checked ?? null
    this.total = options.total ?? null
  }
}

/**
 * Thrown when the artifact schema is required but not found.
 */
export class SchemaNotFoundError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ path?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'SchemaNotFoundError'
    this.path = options.path ?? null
  }
}

/**
 * Thrown when configuration access or mutation fails.
 */
export class ConfigError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ key?: string, value?: unknown, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'ConfigError'
    this.key = options.key ?? null
    this.value = options.value ?? null
  }
}

/**
 * Base error class for bundle-related errors.
 */
export class BundleError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'BundleError'
  }
}

/**
 * Thrown when a bundle's version is not compatible with the current SpecFuse version.
 */
export class BundleVersionMismatchError extends BundleError {
  /**
   * @param {string} message
   * @param {{ bundleVersion?: number, supportedVersion?: number, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'BundleVersionMismatchError'
    this.bundleVersion = options.bundleVersion ?? null
    this.supportedVersion = options.supportedVersion ?? null
  }
}

/**
 * Thrown when a bundle fails validation (missing files, corrupt zip, etc.).
 *
 * Also thrown when a bundle entry attempts to escape the extraction root
 * (zip-slip / path traversal). The offending `entryName` and the
 * `escapedTarget` it would have written to are carried on the instance for
 * programmatic `instanceof` consumers. Because the CLI renders only
 * `err.message`, both values are baked into the message string at throw time.
 */
export class BundleValidationError extends BundleError {
  /**
   * @param {string} message
   * @param {{ missingFiles?: string[], entryName?: string, escapedTarget?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'BundleValidationError'
    this.missingFiles = options.missingFiles ?? null
    this.entryName = options.entryName ?? null
    this.escapedTarget = options.escapedTarget ?? null
  }
}

/**
 * Thrown when import is called without --merge or --replace.
 */
export class ConstitutionConflictError extends BundleError {
  /**
   * @param {string} message
   * @param {{ cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'ConstitutionConflictError'
  }
}

/**
 * Thrown when a batch filter pattern is invalid (e.g., malformed regex).
 */
export class BatchFilterError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ pattern?: string, filterType?: 'glob'|'regex', cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'BatchFilterError'
    this.pattern = options.pattern ?? null
    this.filterType = options.filterType ?? null
  }
}

/**
 * Thrown when the registry is corrupt, has an unexpected shape, or carries an
 * incompatible schema version that could not be migrated. The offending file is
 * quarantined (renamed aside, never deleted) before a fresh registry is
 * initialized, so consumers can recover by hand.
 *
 * `category` is one of `'corruption'` (unparseable JSON or invalid shape) or
 * `'version_mismatch'` (unknown/future schema version). The field is stable so
 * downstream taxonomies (e.g. the sweep W3 failure-observability work) can map
 * into it without rework.
 */
export class RegistryError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ quarantinedPath?: string, originalVersion?: string, category?: 'corruption'|'version_mismatch', cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'RegistryError'
    this.quarantinedPath = options.quarantinedPath ?? null
    this.originalVersion = options.originalVersion ?? null
    this.category = options.category ?? 'corruption'
  }
}

/**
 * Thrown when a registry writer cannot acquire the advisory lock within the
 * configured timeout. Identifies the holding process so the operator can decide
 * whether to wait, increase the timeout, or clear a stale lock.
 */
export class RegistryLockedError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ lockPath?: string, holderPid?: number, holderCommand?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'RegistryLockedError'
    this.lockPath = options.lockPath ?? null
    this.holderPid = options.holderPid ?? null
    this.holderCommand = options.holderCommand ?? null
  }
}

/**
 * Thrown when `specfuse sync` is run with `--no-recover` and an interrupted
 * prior sync is detected (a stale `pendingSync` marker is present). The
 * operator declined automatic recovery; the run is aborted so state can be
 * inspected manually first. Re-running without `--no-recover` reconciles
 * automatically.
 *
 * `code` is the stable machine identifier `INTERRUPTED_SYNC_PENDING` so
 * automation can branch on it without parsing the message.
 */
export class InterruptedSyncPendingError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ startedAt?: string, manifestEntries?: number, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'InterruptedSyncPendingError'
    this.code = 'INTERRUPTED_SYNC_PENDING'
    this.startedAt = options.startedAt ?? null
    this.manifestEntries = options.manifestEntries ?? null
  }
}

/**
 * Thrown when CI init is asked to generate a non-GitHub workflow mode.
 *
 * `code` is the stable machine identifier `CI_UNSUPPORTED_MODE`.
 */
export class CiUnsupportedModeError extends SpecFuseApiError {
  /**
   * @param {string} message
   * @param {{ supportedMode?: string, requestedMode?: string, cause?: Error }} [options]
   */
  constructor(message, options = {}) {
    super(message, { cause: options.cause })
    this.name = 'CiUnsupportedModeError'
    this.code = 'CI_UNSUPPORTED_MODE'
    this.supportedMode = options.supportedMode ?? 'github'
    this.requestedMode = options.requestedMode ?? null
  }
}

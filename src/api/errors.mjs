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

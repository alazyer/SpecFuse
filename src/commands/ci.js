/**
 * SpecFuse CI Integration Commands
 *
 * Thin command layer that re-exports the CI business logic from the core seam
 * (`src/core/ci.js`). Presentation (formatting) and `process.exit` wiring for
 * the CLI live in `src/cli.js`; the API surface (`src/api/ci.mjs`) imports the
 * same logic directly from `src/core/ci.js` so it never reaches into the
 * command layer.
 *
 * Commands:
 *   specfuse ci drift     — Run drift check with CI-optimized output
 *   specfuse ci validate  — Run validation with CI-optimized output
 *   specfuse ci check     — Combined drift + validation
 *   specfuse ci init      — Generate GitHub Actions workflow file
 */

export { ciDrift, ciValidate, ciCheck, ciInit, EVENT_TYPES } from '../core/ci.js'

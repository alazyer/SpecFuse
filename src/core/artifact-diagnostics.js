import { join } from 'path'
import { readdir } from 'fs/promises'
import { pathExists } from '../utils/fs.js'
import { ARTIFACT_ROOTS } from './registry.js'

/**
 * Diagnostic warning codes for artifact root mismatches and issues.
 * Additive only — never remove or change existing code meanings to preserve compatibility.
 */
export const ARTIFACT_DIAGNOSTIC_CODES = {
  /** Both native and governance/non-native roots contain active changes */
  MIXED_CHANGE_ROOTS: 'W1001',
  /** Governance root exists but contains no changes (informational) */
  GOVERNANCE_ROOT_PRESENT: 'W1002',
  /** Archive root is missing or unreadable */
  ARCHIVE_ROOT_UNREADABLE: 'W1003',
  /** Non-canonical change root detected (not .specfuse/changes or openspec/changes) */
  NON_CANONICAL_CHANGE_ROOT: 'W1004',
}

/**
 * Count directories in a path that are not the archive directory.
 * Returns 0 if path doesn't exist or is unreadable.
 * @param {string} dirPath
 * @param {string} [excludeName] Directory name to exclude (e.g. 'archive')
 * @returns {Promise<number>}
 */
async function countActiveDirectories(dirPath, excludeName) {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    return entries.filter(e => e.isDirectory() && e.name !== excludeName).length
  } catch {
    return 0
  }
}

/**
 * Check artifact root consistency and return diagnostics.
 * Implements W1 artifact-location-consistency requirements:
 * - Detects mixed native/governance active change roots
 * - Reports canonical root for native commands
 * - Labels active vs archive roots explicitly
 *
 * @param {string} projectRoot
 * @returns {Promise<ArtifactRootStatus>}
 */
export async function diagnoseArtifactRoots(projectRoot) {
  const nativeChangesRoot = join(projectRoot, ARTIFACT_ROOTS.NATIVE_CHANGES_ACTIVE)
  const nativeArchiveRoot = join(projectRoot, ARTIFACT_ROOTS.NATIVE_CHANGES_ARCHIVE)
  const governanceChangesRoot = join(projectRoot, ARTIFACT_ROOTS.GOVERNANCE_CHANGES)

  const [nativeActiveCount, nativeArchivedCount, governanceActiveCount] = await Promise.all([
    pathExists(nativeChangesRoot) ? countActiveDirectories(nativeChangesRoot, 'archive') : 0,
    pathExists(nativeArchiveRoot) ? countActiveDirectories(nativeArchiveRoot) : 0,
    pathExists(governanceChangesRoot) ? countActiveDirectories(governanceChangesRoot) : 0,
  ])

  const diagnostics = []
  const detectedRoots = []

  if (nativeActiveCount > 0) {
    detectedRoots.push({
      path: ARTIFACT_ROOTS.NATIVE_CHANGES_ACTIVE,
      type: 'native',
      activeChangeCount: nativeActiveCount,
    })
  }

  if (governanceActiveCount > 0) {
    detectedRoots.push({
      path: ARTIFACT_ROOTS.GOVERNANCE_CHANGES,
      type: 'governance',
      activeChangeCount: governanceActiveCount,
    })
  }

  // W1001: Mixed roots - both native and governance have active changes
  if (nativeActiveCount > 0 && governanceActiveCount > 0) {
    diagnostics.push({
      code: ARTIFACT_DIAGNOSTIC_CODES.MIXED_CHANGE_ROOTS,
      severity: 'warning',
      message: `Active changes detected in both native (.specfuse/changes) and governance (openspec/changes) roots. Native specfuse commands only operate on .specfuse/changes; openspec/changes is for OpenSpec governance artifacts only.`,
      canonicalRoot: ARTIFACT_ROOTS.NATIVE_CHANGES_ACTIVE,
      detectedRoots,
    })
  }

  // W1002: Governance root present (informational)
  if (governanceActiveCount > 0 && nativeActiveCount === 0) {
    diagnostics.push({
      code: ARTIFACT_DIAGNOSTIC_CODES.GOVERNANCE_ROOT_PRESENT,
      severity: 'info',
      message: `OpenSpec governance changes detected in openspec/changes. To use these with native specfuse commands, import them first with \`specfuse import\`.`,
      canonicalRoot: ARTIFACT_ROOTS.NATIVE_CHANGES_ACTIVE,
      detectedRoots,
    })
  }

  // Check for non-canonical roots (other directories with change-like structure at project root)
  try {
    const rootEntries = await readdir(projectRoot, { withFileTypes: true })
    for (const entry of rootEntries) {
      if (!entry.isDirectory()) continue
      if (entry.name === '.specfuse' || entry.name === 'openspec' || entry.name.startsWith('.')) continue

      const possibleChangeRoot = join(projectRoot, entry.name, 'changes')
      if (await pathExists(possibleChangeRoot)) {
        const count = await countActiveDirectories(possibleChangeRoot)
        if (count > 0) {
          diagnostics.push({
            code: ARTIFACT_DIAGNOSTIC_CODES.NON_CANONICAL_CHANGE_ROOT,
            severity: 'warning',
            message: `Non-canonical change root detected at ${entry.name}/changes. This is not used by native specfuse commands; canonical root is .specfuse/changes.`,
            canonicalRoot: ARTIFACT_ROOTS.NATIVE_CHANGES_ACTIVE,
            detectedRoots: [
              ...detectedRoots,
              { path: `${entry.name}/changes`, type: 'unknown', activeChangeCount: count }
            ],
          })
        }
      }
    }
  } catch {
    // Ignore unreadable root directory
  }

  return {
    nativeChangesRoot: ARTIFACT_ROOTS.NATIVE_CHANGES_ACTIVE,
    nativeArchiveRoot: ARTIFACT_ROOTS.NATIVE_CHANGES_ARCHIVE,
    governanceChangesRoot: ARTIFACT_ROOTS.GOVERNANCE_CHANGES,
    nativeActiveChangeCount: nativeActiveCount,
    nativeArchivedChangeCount: nativeArchivedCount,
    governanceActiveChangeCount: governanceActiveCount,
    diagnostics,
  }
}

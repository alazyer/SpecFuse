/**
 * Bundle — portable spec bundle creation and extraction.
 *
 * Export packages selected (or full) project state into a self-describing
 * zip archive.  Import unpacks bundles into an existing project with
 * merge, replace, and conflict-handling strategies.
 *
 * Bundle format:  a zip archive containing `specfuse-bundle.json` manifest
 * plus the serialized artifact files.
 */

import { join, resolve as resolvePath, relative, dirname, basename, isAbsolute } from 'path'
import { writeFile, readFile, mkdir, rm, readdir, stat, lstat, realpath } from 'fs/promises'
import { existsSync, createWriteStream as createWriteStreamRaw } from 'fs'
import { createRequire } from 'module'
import archiver from 'archiver'
import yauzl from 'yauzl'

import { Registry, ARTIFACT_PATHS } from './registry.js'
import { recordEvent, EVENT_TYPES } from './history.js'
import { readFileSafe, writeFileAtomic, ensureDir, pathExists } from '../utils/fs.js'
import { logger } from '../utils/logger.js'
import {
  BundleError,
  BundleVersionMismatchError,
  BundleValidationError,
  ConstitutionConflictError,
} from '../api/errors.mjs'

export {
  BundleError,
  BundleVersionMismatchError,
  BundleValidationError,
  ConstitutionConflictError,
} from '../api/errors.mjs'

const require = createRequire(import.meta.url)
const pkg = require('../../package.json')

// ── Constants ──────────────────────────────────────────────────────────────

export const BUNDLE_VERSION = 1
export const BUNDLE_MANIFEST = 'specfuse-bundle.json'
export const BUNDLE_EVENT_TYPES = { export: 'export', import: 'import' }

// ── Export ──────────────────────────────────────────────────────────────────

/**
 * Create a partial bundle (constitution + selected changes + plan artifacts).
 *
 * @param {string} projectRoot
 * @param {import('./registry.js').Registry} registry
 * @param {{ changes?: string[], output?: string, preview?: boolean }} options
 * @returns {Promise<object>} manifest object (and writes zip if not preview)
 */
export async function createBundle(projectRoot, registry, options = {}) {
  const { changes, output, preview } = options

  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    throw new BundleValidationError('.specfuse/ directory not found — run `specfuse init` first.')
  }

  // Collect files to include
  const files = await _collectFiles(projectRoot, { changes })

  // Build manifest
  const manifest = _buildManifest(projectRoot, registry, {
    mode: changes ? 'partial' : 'default',
    changes: changes ?? null,
    fileCount: files.length,
  })

  if (preview) {
    return { manifest, files, preview: true }
  }

  // Determine output path
  const projectName = registry.getProjectName() || 'project'
  const outputPath = output || join(projectRoot, `${projectName}-specfuse-bundle.zip`)

  // Create zip
  await _writeZip(projectRoot, files, manifest, outputPath)

  // Record history event
  recordEvent(registry, EVENT_TYPES.export, `Exported ${files.length} artifact(s) to ${basename(outputPath)}`, {
    mode: manifest.mode,
    fileCount: files.length,
    output: basename(outputPath),
  })

  return { manifest, files, output: outputPath, preview: false }
}

/**
 * Create a full bundle of the entire `.specfuse/` directory.
 *
 * @param {string} projectRoot
 * @param {{ output?: string, preview?: boolean }} options
 * @returns {Promise<object>}
 */
export async function createFullBundle(projectRoot, options = {}) {
  const { output, preview } = options

  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    throw new BundleValidationError('.specfuse/ directory not found — run `specfuse init` first.')
  }

  // Collect all files under .specfuse/ except snapshots/ and .gitignore
  const relFiles = await _collectAllFiles(specDir, ['snapshots', '.gitignore'])
  const files = relFiles.map(f => join('.specfuse', f))

  const registry = new Registry(projectRoot)
  await registry.load()

  const manifest = _buildManifest(projectRoot, registry, {
    mode: 'full',
    changes: null,
    fileCount: files.length,
  })

  if (preview) {
    return { manifest, files, preview: true }
  }

  const projectName = registry.getProjectName() || 'project'
  const outputPath = output || join(projectRoot, `${projectName}-specfuse-bundle.zip`)

  await _writeZip(projectRoot, files, manifest, outputPath)

  recordEvent(registry, EVENT_TYPES.export, `Full export of .specfuse/ to ${basename(outputPath)}`, {
    mode: 'full',
    fileCount: files.length,
    output: basename(outputPath),
  })

  return { manifest, files, output: outputPath, preview: false }
}

// ── Inspect ─────────────────────────────────────────────────────────────────

/**
 * Read a bundle's manifest and file list without extracting.
 *
 * @param {string} bundlePath
 * @returns {Promise<{ manifest: object, files: string[] }>}
 */
export async function inspectBundle(bundlePath) {
  if (!pathExists(bundlePath)) {
    throw new BundleValidationError(`Bundle file not found: ${bundlePath}`)
  }

  return new Promise((resolve, reject) => {
    const files = []
    let manifestData = null

    yauzl.open(bundlePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new BundleValidationError(`Failed to open bundle: ${err.message}`, { cause: err }))
        return
      }

      zipfile.readEntry()
      zipfile.on('error', (zipErr) => {
        // yauzl emits stream errors (e.g. "invalid relative path" for an
        // entry containing `..` traversal) on this event, not through the open
        // callback. Surface them as a BundleValidationError so a malicious
        // bundle is rejected cleanly rather than crashing the import.
        reject(new BundleValidationError(`Bundle stream error: ${zipErr.message}`, { cause: zipErr }))
      })
      zipfile.on('entry', (entry) => {
        files.push(entry.fileName)

        if (entry.fileName === BUNDLE_MANIFEST) {
          zipfile.openReadStream(entry, (err2, readStream) => {
            if (err2) {
              reject(new BundleValidationError(`Failed to read manifest: ${err2.message}`, { cause: err2 }))
              return
            }
            const chunks = []
            readStream.on('data', (chunk) => chunks.push(chunk))
            readStream.on('end', () => {
              try {
                manifestData = JSON.parse(Buffer.concat(chunks).toString('utf8'))
              } catch (e) {
                reject(new BundleValidationError('Manifest is not valid JSON.', { cause: e }))
                return
              }
              zipfile.readEntry()
            })
          })
        } else {
          zipfile.readEntry()
        }
      })

      zipfile.on('end', () => {
        if (!manifestData) {
          reject(new BundleValidationError(`Bundle missing ${BUNDLE_MANIFEST}.`))
          return
        }

        // Validate bundle version
        if (manifestData.bundleVersion > BUNDLE_VERSION) {
          reject(new BundleVersionMismatchError(
            `Bundle version ${manifestData.bundleVersion} is not supported (max: ${BUNDLE_VERSION}).`,
            { bundleVersion: manifestData.bundleVersion, supportedVersion: BUNDLE_VERSION }
          ))
          return
        }

        resolve({ manifest: manifestData, files: files.filter(f => f !== BUNDLE_MANIFEST) })
      })
    })
  })
}

// ── Import ──────────────────────────────────────────────────────────────────

/**
 * Import a bundle into an existing project.
 *
 * @param {string} bundlePath
 * @param {string} projectRoot
 * @param {import('./registry.js').Registry} registry
 * @param {{ merge?: boolean, replace?: boolean, preview?: boolean, conflict?: string }} options
 * @returns {Promise<object>} import report
 */
export async function importBundle(bundlePath, projectRoot, registry, options = {}) {
  const { merge, replace, preview, conflict } = options

  // Validate inputs
  if (!pathExists(bundlePath)) {
    throw new BundleValidationError(`Bundle file not found: ${bundlePath}`)
  }

  const specDir = join(projectRoot, '.specfuse')
  if (!pathExists(specDir)) {
    throw new BundleValidationError('Target project has no .specfuse/ directory — run `specfuse init` first.')
  }

  if (!merge && !replace && !preview) {
    throw new ConstitutionConflictError('Specify --merge or --replace to define how the constitution should be handled.')
  }

  // Inspect the bundle first
  const { manifest, files } = await inspectBundle(bundlePath)

  // Check SpecFuse version compatibility
  const versionWarn = _checkVersionCompatibility(manifest)

  if (preview) {
    const report = _buildImportReport(manifest, files, projectRoot, { merge, replace, conflict, versionWarn })
    return { ...report, preview: true }
  }

  // Perform the actual import
  const report = await _extractBundle(bundlePath, projectRoot, manifest, { merge, replace, conflict })

  // Record history event
  recordEvent(registry, EVENT_TYPES.import, `Imported ${report.imported.length} artifact(s) from ${basename(bundlePath)}`, {
    source: manifest.projectName,
    mode: merge ? 'merge' : 'replace',
    conflict,
    imported: report.imported.length,
    skipped: report.skipped.length,
  })

  // Record import in registry
  if (registry.recordImport) {
    registry.recordImport({
      timestamp: new Date().toISOString(),
      sourceProject: manifest.projectName,
      mode: merge ? 'merge' : 'replace',
      conflict,
      artifactCounts: { imported: report.imported.length, skipped: report.skipped.length, renamed: report.renamed.length },
    })
  }
  await registry.save()

  if (versionWarn) report.versionWarn = versionWarn
  return report
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build the manifest object.
 */
function _buildManifest(projectRoot, registry, { mode, changes, fileCount }) {
  return {
    specfuseVersion: pkg.version,
    bundleVersion: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    projectName: registry.getProjectName() || basename(projectRoot),
    mode,
    contents: {
      changes: changes ?? null,
    },
    fileCount,
  }
}

/**
 * Collect files for a partial or default export.
 */
async function _collectFiles(projectRoot, { changes }) {
  const files = []
  const specDir = join(projectRoot, '.specfuse')

  // Always include constitution
  if (pathExists(join(specDir, 'constitution.md'))) {
    files.push('.specfuse/constitution.md')
  }

  // Include plan artifacts
  for (const [key, relPath] of Object.entries(ARTIFACT_PATHS)) {
    if (key.startsWith('plan:')) {
      const fullPath = join(projectRoot, relPath)
      if (pathExists(fullPath)) {
        try {
          const info = await stat(fullPath)
          if (info.isDirectory()) {
            const dirFiles = await _listDirRecursive(fullPath, specDir)
            files.push(...dirFiles)
          } else {
            const normalized = relPath.startsWith('.specfuse/') ? relPath : `.specfuse/${relPath.replace(/^\.specfuse\/?/, '')}`
            files.push(normalized)
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }

  // Include change directories
  const changesDir = join(specDir, 'changes')
  if (pathExists(changesDir)) {
    if (changes && changes.length > 0) {
      for (const changeName of changes) {
        const changePath = join(changesDir, changeName)
        if (pathExists(changePath)) {
          const dirFiles = await _listDirRecursive(changePath, specDir)
          files.push(...dirFiles)
        }
      }
    } else {
      // All active changes (not archive)
      const entries = await readdir(changesDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name !== 'archive') {
          const dirFiles = await _listDirRecursive(join(changesDir, entry.name), specDir)
          files.push(...dirFiles)
        }
      }
    }
  }

  // Include registry
  if (pathExists(join(specDir, 'registry.json'))) {
    files.push('.specfuse/registry.json')
  }

  return [...new Set(files)]
}

/**
 * Collect all files under a directory, excluding specified names.
 */
async function _collectAllFiles(dir, exclude = []) {
  const files = []

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else {
        files.push(relative(dir, fullPath))
      }
    }
  }

  await walk(dir)
  return files
}

/**
 * List all files in a directory recursively, returning paths relative to baseDir.
 */
async function _listDirRecursive(dir, baseDir) {
  const files = []

  async function walk(current) {
    const entries = await readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
      } else {
        files.push(join('.specfuse', relative(baseDir, fullPath)))
      }
    }
  }

  await walk(dir)
  return files
}

/**
 * Write files + manifest into a zip archive.
 */
async function _writeZip(projectRoot, files, manifest, outputPath) {
  await ensureDir(dirname(outputPath))

  return new Promise((resolve, reject) => {
    const output = createWriteStreamRaw(outputPath)
    const archive = archiver('zip', { zlib: { level: 9 } })

    output.on('close', () => resolve())
    archive.on('error', (err) => reject(err))

    archive.pipe(output)

    // Add manifest
    archive.append(JSON.stringify(manifest, null, 2) + '\n', { name: BUNDLE_MANIFEST })

    // Add files
    for (const relPath of files) {
      const fullPath = join(projectRoot, relPath)
      if (pathExists(fullPath)) {
        try {
          const info = stat(fullPath)
          // Use sync check — archiver handles missing gracefully
          archive.file(fullPath, { name: relPath })
        } catch {
          // skip
        }
      }
    }

    archive.finalize()
  })
}

/** Path separator split that tolerates both / and \ (cross-platform zips). */
const sepPattern = /[\\/]+/

/**
 * lstat that returns null for a missing path (ENOENT) rather than throwing.
 * @param {string} p
 * @returns {Promise<import('fs').Stats | null>}
 */
async function lstatSafe(p) {
  try {
    return await lstat(p)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/**
 * realpath that returns the input path on failure (best-effort). Used only after
 * an lstat confirmed the target is a symlink, so ENOENT is not expected here.
 * @param {string} p
 * @returns {Promise<string>}
 */
async function realpathSafe(p) {
  try {
    return await realpath(p)
  } catch {
    // If realpath fails (e.g. dangling symlink), treat the link target as the
    // path itself — the lstat already proved a symlink exists, so a dangling
    // link is itself suspicious; fall back to rejecting conservatively below.
    return p
  }
}

/**
 * Resolve a bundle entry's path against the extraction root, rejecting any
 * entry that escapes the root via `..` traversal, an absolute path, or a
 * symlinked intermediate/leaf directory pointing outside the root.
 *
 * This is the single zip-slip / path-traversal containment primitive. Every
 * extraction write site MUST route its target path through this helper before
 * any `ensureDir` / `writeFileAtomic` / `createWriteStreamRaw` call.
 *
 * Algorithm (per design.md §5, with the leaf-symlink requirement from the spec):
 *  1. Reject absolute entry names (`/etc/passwd`, `C:\...`).
 *  2. Compute `resolved = path.resolve(root, entryName)` and `resolvedRoot`.
 *  3. Reject if `relative(resolvedRoot, resolved)` starts with `..` or is
 *     absolute — the name does not resolve inside the root.
 *  4. Reject if any intermediate segment is a symlink whose realpath escapes
 *     `resolvedRoot` (covers a symlinked directory redirecting a write).
 *  5. Reject if the resolved leaf already exists as a symlink whose realpath
 *     escapes `resolvedRoot` — the leaf name is inside the root, but the write
 *     would follow the symlink out.
 *
 * Uses `path` primitives throughout so platform separators normalize; zip entry
 * names use forward slashes which `path.resolve` handles on every platform.
 *
 * @param {string} root - Absolute extraction root (projectRoot).
 * @param {string} entryName - Zip entry fileName, relative to the root.
 * @returns {string} The validated absolute path inside `root`.
 * @throws {BundleValidationError} If the entry escapes the root. The error
 *   message names the offending entry and escaped target; `entryName` and
 *   `escapedTarget` are also on the instance for `instanceof` consumers.
 */
export async function resolveSafeExtractionPath(root, entryName) {
  const resolvedRoot = resolvePath(root)

  // 1. Absolute entry names bypass the root entirely.
  if (isAbsolute(entryName)) {
    throw new BundleValidationError(
      `Bundle entry "${entryName}" uses an absolute path, which is not allowed (would write outside the extraction root).`,
      { entryName, escapedTarget: entryName },
    )
  }

  const resolved = resolvePath(resolvedRoot, entryName)

  // 2. The resolved name must be equal to or a child of the root.
  const rel = relative(resolvedRoot, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new BundleValidationError(
      `Bundle entry "${entryName}" resolves outside the extraction root to "${resolved}" — path traversal is not allowed.`,
      { entryName, escapedTarget: resolved },
    )
  }

  // 3. Walk every intermediate directory segment and reject a symlink whose
  //    realpath escapes the root. Intermediate dirs that don't yet exist are
  //    fine (we create them); a symlinked intermediate that already exists and
  //    points outward is not.
  const segments = rel ? rel.split(sepPattern) : []
  let current = resolvedRoot
  for (let i = 0; i < segments.length; i++) {
    current = join(current, segments[i])
    const info = await lstatSafe(current)
    if (info?.isSymbolicLink()) {
      const real = await realpathSafe(current)
      const realRel = relative(resolvedRoot, real)
      if (realRel.startsWith('..') || isAbsolute(realRel)) {
        throw new BundleValidationError(
          `Bundle entry "${entryName}" crosses a symlink ("${segments[i]}") that resolves outside the extraction root to "${real}".`,
          { entryName, escapedTarget: real },
        )
      }
    }
  }

  // 4. The leaf itself: if it already exists as a symlink, its realpath must
  //    stay inside the root. A leaf symlink to e.g. /etc/passwd passes the name
  //    check above (the leaf name is inside the root) but the write would
  //    follow it out — reject it. (Spec requirement; not optional.)
  const leafInfo = await lstatSafe(resolved)
  if (leafInfo?.isSymbolicLink()) {
    const real = await realpathSafe(resolved)
    const realRel = relative(resolvedRoot, real)
    if (realRel.startsWith('..') || isAbsolute(realRel)) {
      throw new BundleValidationError(
        `Bundle entry "${entryName}" targets a leaf symlink that resolves outside the extraction root to "${real}".`,
        { entryName, escapedTarget: real },
      )
    }
  }

  return resolved
}

/**
 * Extract a bundle, applying merge/replace and conflict strategies.
 */
async function _extractBundle(bundlePath, projectRoot, manifest, { merge, replace, conflict }) {
  const report = { imported: [], skipped: [], renamed: [], constitution: null }
  const preexistingChanges = await _listExistingChangeNames(projectRoot)

  return new Promise((resolve, reject) => {
    yauzl.open(bundlePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) {
        reject(new BundleValidationError(`Failed to open bundle: ${err.message}`, { cause: err }))
        return
      }

      let pending = 0
      let done = false
      let aborted = false

      function checkDone() {
        if (!aborted && done && pending === 0) {
          resolve(report)
        }
      }

      // Single point of failure: once the extraction aborts (a malicious entry,
      // a stream error, or a write failure), resolve must never fire and every
      // later reject is a no-op. This closes the resolve/reject race that
      // otherwise lets a late `done`+`pending===0` resolve an incomplete report
      // after a malicious entry has already rejected.
      function fail(err) {
        if (aborted) return
        aborted = true
        reject(err)
      }

      zipfile.readEntry()
      zipfile.on('error', (zipErr) => {
        // yauzl emits stream errors (e.g. "invalid relative path" for an
        // entry containing `..` traversal) on this event, not through the
        // open callback. Surface them as a BundleValidationError so a malicious
        // entry aborts the import cleanly instead of crashing the process.
        fail(new BundleValidationError(`Bundle stream error: ${zipErr.message}`, { cause: zipErr }))
      })
      zipfile.on('entry', async (entry) => {
        if (aborted) return
        try {
          if (entry.fileName === BUNDLE_MANIFEST) {
            zipfile.readEntry()
            return
          }

          // Handle directories — just create them. Resolve the contained path
          // before ensureDir so a traversal entry is rejected synchronously
          // rather than creating directories outside the root.
          if (entry.fileName.endsWith('/')) {
            const safeDir = await resolveSafeExtractionPath(projectRoot, entry.fileName)
            ensureDir(safeDir).then(() => zipfile.readEntry()).catch((err) => fail(err))
            return
          }

          // Validate the entry path before any write. All write sites below
          // (constitution branch, default branch) reuse this validated path.
          const targetPath = await resolveSafeExtractionPath(projectRoot, entry.fileName)

          // Handle constitution specially
          if (entry.fileName === '.specfuse/constitution.md') {
            pending++
            zipfile.openReadStream(entry, (err2, readStream) => {
              if (err2) {
                pending--
                checkDone()
                zipfile.readEntry()
                return
              }

              const chunks = []
              readStream.on('data', (chunk) => chunks.push(chunk))
              readStream.on('end', async () => {
                try {
                  const importedContent = Buffer.concat(chunks).toString('utf8')

                  if (replace) {
                    await ensureDir(dirname(targetPath))
                    await writeFileAtomic(targetPath, importedContent)
                    report.imported.push(entry.fileName)
                    report.constitution = 'replaced'
                  } else if (merge) {
                    const localContent = await readFileSafe(targetPath) || ''
                    const merged = _mergeConstitution(localContent, importedContent, manifest.projectName)
                    await ensureDir(dirname(targetPath))
                    await writeFileAtomic(targetPath, merged)
                    report.imported.push(entry.fileName)
                    report.constitution = 'merged'
                  }
                } catch (err) {
                  fail(err)
                  return
                }

                pending--
                checkDone()
                zipfile.readEntry()
              })
            })
            return
          }

          // Handle change directories with conflict strategy
          if (entry.fileName.startsWith('.specfuse/changes/') && !entry.fileName.startsWith('.specfuse/changes/archive/')) {
            const changeName = _extractChangeName(entry.fileName)
            if (changeName) {
              if (preexistingChanges.has(changeName)) {
                const strategy = conflict || 'skip'
                if (strategy === 'skip') {
                  report.skipped.push(entry.fileName)
                  zipfile.readEntry()
                  return
                } else if (strategy === 'rename') {
                  const ts = Date.now()
                  const newName = `${changeName}-imported-${ts}`
                  const renamedPath = entry.fileName.replace(changeName, newName)
                  // Re-validate the renamed path: a pre-existing `..` outside
                  // the change-name segment survives String.prototype.replace.
                  const safeRenamedPath = await resolveSafeExtractionPath(projectRoot, renamedPath)
                  pending++
                  _extractEntry(zipfile, entry, safeRenamedPath, (extracted) => {
                    if (extracted) {
                      report.imported.push(renamedPath)
                      report.renamed.push({ original: entry.fileName, renamed: renamedPath })
                    }
                    pending--
                    checkDone()
                    zipfile.readEntry()
                  })
                  return
                }
                // strategy === 'overwrite' → fall through to default extraction
              }
            }
          }

          // Handle registry.json — skip, we merge selectively
          if (entry.fileName === '.specfuse/registry.json') {
            report.skipped.push(entry.fileName)
            zipfile.readEntry()
            return
          }

          // Default: extract file
          pending++
          _extractEntry(zipfile, entry, targetPath, (extracted) => {
            if (extracted) {
              report.imported.push(entry.fileName)
            } else {
              report.skipped.push(entry.fileName)
            }
            pending--
            checkDone()
            zipfile.readEntry()
          })
        } catch (err) {
          fail(err)
        }
      })

      zipfile.on('end', () => {
        done = true
        checkDone()
      })
    })
  })
}

/**
 * List active change names that existed before an import starts.
 */
async function _listExistingChangeNames(projectRoot) {
  const changesDir = join(projectRoot, '.specfuse', 'changes')
  if (!pathExists(changesDir)) return new Set()

  const entries = await readdir(changesDir, { withFileTypes: true })
  return new Set(entries.filter((entry) => entry.isDirectory() && entry.name !== 'archive').map((entry) => entry.name))
}

/**
 * Extract a single zip entry to a file on disk.
 */
function _extractEntry(zipfile, entry, targetPath, callback) {
  zipfile.openReadStream(entry, (err, readStream) => {
    if (err) {
      callback(false)
      return
    }

    ensureDir(dirname(targetPath)).then(() => {
      const writeStream = createWriteStreamRaw(targetPath)
      writeStream.on('close', () => callback(true))
      writeStream.on('error', () => callback(false))
      readStream.pipe(writeStream)
    }).catch(() => callback(false))
  })
}

/**
 * Extract change name from a path like `.specfuse/changes/add-login/proposal.md`.
 */
function _extractChangeName(filePath) {
  const parts = filePath.split('/')
  if (parts.length >= 3 && parts[0] === '.specfuse' && parts[1] === 'changes') {
    return parts[2]
  }
  return null
}

/**
 * Merge imported constitution into local constitution.
 * Section-aware: scans for ## headings and appends each section
 * under a `<!-- imported from <project> -->` marker.
 */
export function _mergeConstitution(localContent, importedContent, sourceProject) {
  const source = sourceProject || 'unknown'

  if (!localContent.trim()) return importedContent
  if (!importedContent.trim()) return localContent

  const importedSections = _parseSections(importedContent)
  const localHeadings = new Set(
    [...localContent.matchAll(/^##\s+(.+)$/gm)].map(m => m[1].trim())
  )

  let merged = localContent
  merged += `\n\n<!-- imported from ${source} -->\n`

  for (const section of importedSections) {
    if (localHeadings.has(section.heading)) {
      merged += `\n## ${section.heading} (imported)\n\n${section.body}\n`
    } else {
      merged += `\n## ${section.heading}\n\n${section.body}\n`
    }
  }

  return merged.trimEnd() + '\n'
}

/**
 * Parse markdown content into sections by ## headings.
 */
export function _parseSections(content) {
  const sections = []
  const lines = content.split('\n')
  let currentHeading = null
  let currentBody = []

  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (currentHeading !== null) {
        sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
      }
      currentHeading = line.replace(/^##\s+/, '').trim()
      currentBody = []
    } else if (currentHeading !== null) {
      currentBody.push(line)
    }
  }

  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, body: currentBody.join('\n').trim() })
  }

  return sections
}

/**
 * Check SpecFuse version compatibility between bundle and local install.
 */
function _checkVersionCompatibility(manifest) {
  if (!manifest.specfuseVersion) return null

  const localVersion = pkg.version
  const [localMajor] = localVersion.split('.').map(Number)
  const [bundleMajor] = manifest.specfuseVersion.split('.').map(Number)

  if (localMajor !== bundleMajor) {
    return `Bundle was exported from SpecFuse v${manifest.specfuseVersion} but you are running v${localVersion}. Major version mismatch — data format may have diverged.`
  }

  return null
}

/**
 * Build a preview import report.
 */
function _buildImportReport(manifest, files, projectRoot, { merge, replace, conflict, versionWarn }) {
  const constitutionFiles = files.filter(f => f === '.specfuse/constitution.md')
  const changeFiles = files.filter(f => f.startsWith('.specfuse/changes/') && !f.startsWith('.specfuse/changes/archive/'))
  const planFiles = files.filter(f => f.startsWith('.specfuse/plan/'))
  const otherFiles = files.filter(f =>
    f !== '.specfuse/constitution.md' &&
    !f.startsWith('.specfuse/changes/') &&
    !f.startsWith('.specfuse/plan/')
  )

  const changeNames = new Set()
  for (const f of changeFiles) {
    const name = _extractChangeName(f)
    if (name) changeNames.add(name)
  }

  const conflicts = []
  const wouldImport = []
  for (const name of changeNames) {
    if (pathExists(join(projectRoot, '.specfuse', 'changes', name))) {
      conflicts.push(name)
    } else {
      wouldImport.push(name)
    }
  }

  return {
    source: manifest.projectName,
    exportedAt: manifest.exportedAt,
    mode: manifest.mode,
    constitution: {
      exists: constitutionFiles.length > 0,
      action: merge ? 'merge' : replace ? 'replace' : 'unspecified',
    },
    changes: {
      total: changeNames.size,
      wouldImport,
      conflicts,
      conflictStrategy: conflict || 'skip',
    },
    plan: { files: planFiles.length },
    other: { files: otherFiles.length },
    versionWarn,
  }
}

// ── Output formatting ────────────────────────────────────────────────────────

import chalk from 'chalk'

export function formatBundleTable(manifest) {
  const rows = []
  rows.push(`  Project:         ${chalk.bold(manifest.projectName)}`)
  rows.push(`  Mode:            ${chalk.cyan(manifest.mode)}`)
  rows.push(`  Exported:        ${chalk.dim(manifest.exportedAt)}`)
  rows.push(`  SpecFuse:        ${chalk.dim('v' + manifest.specfuseVersion)}`)
  rows.push(`  Bundle version:  ${chalk.dim(manifest.bundleVersion)}`)
  rows.push(`  Files:           ${chalk.bold(manifest.fileCount)}`)
  return rows.join('\n')
}

export function formatBundleJson(manifest) {
  return JSON.stringify(manifest, null, 2)
}

export function formatImportReportJson(report) {
  return JSON.stringify(report, null, 2)
}

export function formatImportReportTable(report) {
  const rows = []
  rows.push(`  Source:          ${chalk.bold(report.source)}`)
  rows.push(`  Exported:        ${chalk.dim(report.exportedAt)}`)
  rows.push(`  Constitution:    ${report.constitution.action === 'merge' ? chalk.cyan('merge') : report.constitution.action === 'replace' ? chalk.yellow('replace') : chalk.red('unspecified')}`)

  if (report.changes) {
    rows.push(`  Changes:         ${chalk.bold(report.changes.total)} total`)
    if (report.changes.wouldImport?.length > 0) {
      rows.push(`    Would import:  ${chalk.green(report.changes.wouldImport.join(', '))}`)
    }
    if (report.changes.conflicts?.length > 0) {
      rows.push(`    Conflicts:    ${chalk.yellow(report.changes.conflicts.join(', '))} (${report.changes.conflictStrategy})`)
    }
  }

  if (report.plan?.files > 0) {
    rows.push(`  Plan files:      ${report.plan.files}`)
  }

  if (report.versionWarn) {
    rows.push(`  ${chalk.yellow('⚠')}  ${report.versionWarn}`)
  }

  return rows.join('\n')
}

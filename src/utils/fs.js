import { readFile, writeFile, rename, mkdir, stat, readdir, open, unlink } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'
import { RegistryLockedError } from '../api/errors.mjs'

/**
 * Read a file, returning null if it doesn't exist.
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
export async function readFileSafe(filePath) {
  try {
    return await readFile(filePath, 'utf8')
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/**
 * Write a file atomically: write to a temp file then rename.
 * Ensures the directory exists first.
 * @param {string} filePath
 * @param {string} content
 */
export async function writeFileAtomic(filePath, content) {
  const dir = dirname(filePath)
  await mkdir(dir, { recursive: true })
  const tmp = join(tmpdir(), `specfuse-${randomBytes(6).toString('hex')}.tmp`)
  await writeFile(tmp, content, 'utf8')
  await rename(tmp, filePath)
}

/**
 * Check if a path exists.
 * @param {string} p
 * @returns {boolean}
 */
export function pathExists(p) {
  return existsSync(p)
}

/**
 * Get last-modified time of a file, or null if missing.
 * @param {string} filePath
 * @returns {Promise<Date|null>}
 */
export async function getModifiedTime(filePath) {
  try {
    const s = await stat(filePath)
    return s.mtime
  } catch {
    return null
  }
}

/**
 * List files in a directory matching a glob-like extension.
 * @param {string} dir
 * @param {string} ext  e.g. '.md'
 * @returns {Promise<string[]>}  Full paths
 */
export async function listFiles(dir, ext) {
  const result = await listFilesDetailed(dir, ext)
  return result.files
}

/**
 * List files in a directory and classify the scan outcome.
 * @param {string} dir
 * @param {string} ext
 * @returns {Promise<{ files: string[], state: 'scanned'|'absent_valid'|'unreadable', error?: string }>}
 */
export async function listFilesDetailed(dir, ext) {
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return {
      files: entries
        .filter((e) => e.isFile() && (!ext || e.name.endsWith(ext)))
        .map((e) => join(dir, e.name)),
      state: 'scanned',
    }
  } catch (err) {
    if (err?.code === 'ENOENT') {
      return { files: [], state: 'absent_valid' }
    }
    return { files: [], state: 'unreadable', error: err?.message ?? 'Unable to read directory.' }
  }
}

/**
 * Ensure a directory exists.
 * @param {string} dir
 */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

// ── Registry advisory locking ────────────────────────────────────────────────

const DEFAULT_LOCK_TIMEOUT_MS = 5000
const DEFAULT_LOCK_POLL_MS = 50
const MAX_LOCK_POLL_MS = 500

/**
 * Test whether a process is currently running by sending signal 0.
 * Resolves false for ESRCH (no such process); EPERM means the process exists
 * but we lack permission (treated as alive).
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but we lack permission (alive)
    return err.code === 'EPERM'
  }
}

/**
 * Parse a lockfile's contents into { pid, command, acquiredAt }.
 * Returns null if the file is absent or unparseable.
 * @param {string} lockPath
 * @returns {Promise<{pid:number,command:string,acquiredAt:number}|null>}
 */
async function readPidLock(lockPath) {
  const raw = await readFileSafe(lockPath)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const pid = Number(parsed.pid)
    if (!Number.isInteger(pid) || pid <= 0) return null
    return {
      pid,
      command: typeof parsed.command === 'string' ? parsed.command : 'unknown',
      acquiredAt: typeof parsed.acquiredAt === 'number' ? parsed.acquiredAt : 0,
    }
  } catch {
    return null
  }
}

/**
 * Acquire a PID-based advisory lock for the registry load-mutate-save sequence.
 *
 * Writes a lockfile containing the holder's PID + command + timestamp using the
 * atomic write pattern. If a lockfile already exists, polls up to `timeout` ms,
 * reclaiming the lock if the holding PID is no longer alive (stale lock). On
 * timeout, throws a structured `RegistryLockedError` identifying the holder.
 *
 * @param {string} lockPath - Absolute path to the lockfile
 * @param {{ timeout?: number, pollMs?: number, pid?: number, command?: string }} [options]
 * @returns {Promise<void>}
 */
export async function acquirePidLock(lockPath, options = {}) {
  const timeout = options.timeout ?? DEFAULT_LOCK_TIMEOUT_MS
  const pid = options.pid ?? process.pid
  const command = options.command ?? process.argv?.slice(1, 3).join(' ') ?? 'specfuse'
  let pollMs = options.pollMs ?? DEFAULT_LOCK_POLL_MS

  await ensureDir(dirname(lockPath))
  const deadline = Date.now() + timeout

  for (;;) {
    // Atomically create the lockfile ONLY if it does not already exist
    // (O_EXCL). This is the mutual-exclusion primitive — rename would
    // overwrite, so we must use O_EXCL to refuse an existing holder.
    const payload = JSON.stringify({ pid, command, acquiredAt: Date.now() }) + '\n'
    let acquired = false
    let handle
    try {
      // O_EXCL fails with EEXIST if the file is present — true atomic create.
      handle = await open(lockPath, 'wx')
      await handle.writeFile(payload, 'utf8')
      acquired = true
    } catch (err) {
      if (err.code !== 'EEXIST') {
        // Unexpected error — surface it rather than spin forever.
        throw err
      }
      // File exists; fall through to staleness check.
    } finally {
      if (handle) {
        try {
          await handle.close()
        } catch {
          /* best-effort */
        }
      }
    }
    if (acquired) return

    // A lockfile exists — inspect the holder.
    const holder = await readPidLock(lockPath)
    if (holder) {
      if (holder.pid === pid) return // re-entrant: same process already holds
      const alive = await isProcessAlive(holder.pid)
      if (!alive) {
        // Stale lock — reclaim. unlink is best-effort; if we lose the race to
        // another reclaimer, the next loop iteration re-checks.
        try {
          await unlink(lockPath)
          // Loop: try O_EXCL again immediately.
          continue
        } catch (err) {
          if (err.code !== 'ENOENT') {
            // Could not remove — fall through to polling.
          }
        }
      }
    }

    if (Date.now() >= deadline) {
      const finalHolder = await readPidLock(lockPath)
      throw new RegistryLockedError(
        `Could not acquire registry lock at ${lockPath}` +
          (finalHolder
            ? ` — held by PID ${finalHolder.pid} (${finalHolder.command})`
            : ' — lock file is busy'),
        {
          lockPath,
          holderPid: finalHolder?.pid ?? null,
          holderCommand: finalHolder?.command ?? null,
        },
      )
    }

    await sleep(pollMs)
    // Gentle backoff up to a cap so long waits don't spin tightly.
    pollMs = Math.min(pollMs * 1.5, MAX_LOCK_POLL_MS)
  }
}

/**
 * Release a previously acquired PID lock. Only removes the file if it still
 * references the current PID (avoids clobbering a lock a different process has
 * since acquired). Errors are swallowed — release is best-effort and must never
 * mask an in-flight failure.
 *
 * @param {string} lockPath
 * @param {{ pid?: number }} [options]
 * @returns {Promise<void>}
 */
export async function releasePidLock(lockPath, options = {}) {
  const pid = options.pid ?? process.pid
  const holder = await readPidLock(lockPath)
  if (!holder) return
  if (holder.pid !== pid) return // not ours — leave it
  try {
    await unlink(lockPath)
  } catch (err) {
    if (err.code !== 'ENOENT') {
      /* best-effort: swallow; release must never mask an in-flight failure */
    }
  }
}

/** Read a PID lockfile without acquiring. @returns {Promise<object|null>} */
export function readLockFile(lockPath) {
  return readPidLock(lockPath)
}

/** Check whether a PID is alive. Exported for doctor. @returns {boolean} */
export function isPidAlive(pid) {
  return isProcessAlive(pid)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

import { readFile, writeFile, rename, mkdir, stat, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomBytes } from 'crypto'

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
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    return entries
      .filter((e) => e.isFile() && (!ext || e.name.endsWith(ext)))
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

/**
 * Ensure a directory exists.
 * @param {string} dir
 */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
}

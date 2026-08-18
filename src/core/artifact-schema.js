import { isAbsolute, join, relative, resolve } from 'path'
import { pathExists, readFileSafe, writeFileAtomic } from '../utils/fs.js'
import { SchemaValidationError, SchemaNotFoundError } from '../api/errors.mjs'

export const DEFAULT_ARTIFACT_SCHEMA_PATH = '.specfuse/artifact-schema.json'

const SCHEMA_TEMPLATE = {
  version: 1,
  artifacts: {
    'change.*': {
      instructions: ['Keep language concise and implementation-oriented.'],
    },
    'change.proposal': {
      instructions: ['Always link related issue IDs in the Overview section.'],
    },
    'plan.story': {
      instructions: ['Add at least one acceptance criterion for unhappy-path behavior.'],
    },
  },
}

function toSchemaPath(projectRoot, schemaPath) {
  if (!schemaPath) return join(projectRoot, DEFAULT_ARTIFACT_SCHEMA_PATH)
  return isAbsolute(schemaPath) ? schemaPath : resolve(projectRoot, schemaPath)
}

function formatSchemaPath(projectRoot, fullPath) {
  const rel = relative(projectRoot, fullPath).replace(/\\/g, '/')
  return rel && !rel.startsWith('..') ? rel : fullPath
}

function validateInstructionsArray(artifactId, value) {
  if (!Array.isArray(value)) {
    throw new SchemaValidationError(`artifacts.${artifactId}.instructions must be an array of strings.`, {
      artifactId,
      field: 'instructions',
    })
  }

  const cleaned = []
  for (let i = 0; i < value.length; i++) {
    const entry = value[i]
    if (typeof entry !== 'string') {
      throw new SchemaValidationError(`artifacts.${artifactId}.instructions[${i}] must be a string.`, {
        artifactId,
        field: `instructions[${i}]`,
      })
    }
    const trimmed = entry.trim()
    if (trimmed) cleaned.push(trimmed)
  }
  return cleaned
}

function normalizeArtifacts(artifacts) {
  if (artifacts === null || artifacts === undefined) return {}
  if (typeof artifacts !== 'object' || Array.isArray(artifacts)) {
    throw new SchemaValidationError('artifacts must be an object keyed by artifact ID.', {
      artifactId: null,
      field: 'artifacts',
    })
  }

  const normalized = {}
  for (const [artifactId, config] of Object.entries(artifacts)) {
    if (!artifactId.trim()) {
      throw new SchemaValidationError('artifact ID keys cannot be empty.', { field: 'artifactId' })
    }
    if (Array.isArray(config)) {
      normalized[artifactId] = validateInstructionsArray(artifactId, config)
      continue
    }
    if (typeof config !== 'object' || config === null || config === undefined) {
      throw new SchemaValidationError(`artifacts.${artifactId} must be an object or string array.`, {
        artifactId,
        field: artifactId,
      })
    }
    normalized[artifactId] = validateInstructionsArray(artifactId, config.instructions ?? [])
  }
  return normalized
}

/**
 * @param {string} projectRoot
 * @param {{ schemaPath?: string, requireExists?: boolean }} [options]
 */
export async function loadArtifactSchema(projectRoot, options = {}) {
  const fullPath = toSchemaPath(projectRoot, options.schemaPath)
  const displayPath = formatSchemaPath(projectRoot, fullPath)
  if (!pathExists(fullPath)) {
    if (options.requireExists) {
      throw new SchemaNotFoundError(`Artifact schema not found: ${displayPath}`, { path: displayPath })
    }
    return { path: fullPath, displayPath, exists: false, version: 1, artifacts: {} }
  }

  const raw = await readFileSafe(fullPath)
  let parsed
  try {
    parsed = JSON.parse(raw ?? '{}')
  } catch (err) {
    throw new SchemaValidationError(`Invalid JSON in ${displayPath}: ${err.message}`, {
      path: displayPath,
      field: 'json',
      cause: err,
    })
  }

  if (typeof parsed !== 'object' || parsed === null || parsed === undefined || Array.isArray(parsed)) {
    throw new SchemaValidationError(`${displayPath} must contain a JSON object.`, { field: 'root' })
  }

  const version = parsed.version ?? 1
  if (version !== 1) {
    throw new SchemaValidationError(`${displayPath} uses unsupported version '${version}'. Expected version 1.`, {
      field: 'version',
      value: version,
    })
  }

  const artifacts = normalizeArtifacts(parsed.artifacts)
  return { path: fullPath, displayPath, exists: true, version, artifacts }
}

/**
 * @param {{ artifacts: Record<string, string[]> }} schema
 * @param {string} artifactId
 */
export function getArtifactSchemaInstructions(schema, artifactId) {
  const instructions = []
  const add = (value) => {
    if (value && !instructions.includes(value)) instructions.push(value)
  }
  const artifacts = schema?.artifacts ?? {}

  for (const [key, values] of Object.entries(artifacts)) {
    if (!key.endsWith('*')) continue
    const prefix = key.slice(0, -1)
    if (!artifactId.startsWith(prefix)) continue
    values.forEach(add)
  }

  for (const value of artifacts[artifactId] ?? []) add(value)
  return instructions
}

/**
 * @param {string} content
 * @param {string[]} instructions
 */
export function applyArtifactSchemaInstructions(content, instructions) {
  if (!instructions?.length) return content
  const cleaned = content.trimEnd()
  const bullets = instructions.map((line) => `- ${line}`).join('\n')
  const block = `## Custom Instructions (Schema)\n\n${bullets}\n`
  return cleaned ? `${cleaned}\n\n${block}` : block
}

/**
 * @param {string} projectRoot
 * @param {{ schemaPath?: string, force?: boolean }} [options]
 */
export async function initArtifactSchema(projectRoot, options = {}) {
  const fullPath = toSchemaPath(projectRoot, options.schemaPath)
  const displayPath = formatSchemaPath(projectRoot, fullPath)
  if (pathExists(fullPath) && !options.force) {
    return { created: false, path: fullPath, displayPath }
  }
  await writeFileAtomic(fullPath, JSON.stringify(SCHEMA_TEMPLATE, null, 2) + '\n')
  return { created: true, path: fullPath, displayPath }
}

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'

import * as change from '../api/change.mjs'

const CLI_PATH = fileURLToPath(new URL('../../bin/specfuse.js', import.meta.url))

async function makeProject(root) {
  await mkdir(join(root, '.specfuse'), { recursive: true })
  await writeFile(
    join(root, '.specfuse', 'constitution.md'),
    '# Project Constitution\n\n## Rules\n\n- Keep parity\n',
  )
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_PATH, ...args, '--root', root], {
    cwd: root,
    encoding: 'utf8',
  })
}

async function listRelativeFiles(root) {
  const changesDir = join(root, '.specfuse', 'changes')
  const result = []
  const active = await readdir(changesDir, { withFileTypes: true }).catch(() => [])
  for (const entry of active) {
    if (!entry.isDirectory() || entry.name === 'archive') continue
    for (const file of ['proposal.md', 'design.md', 'tasks.md', 'review.md', 'verify.md']) {
      const filePath = join(changesDir, entry.name, file)
      if (existsSync(filePath)) result.push(filePath.replace(`${root}/`, ''))
    }
  }
  const archiveDir = join(changesDir, 'archive')
  const archived = await readdir(archiveDir, { withFileTypes: true }).catch(() => [])
  for (const entry of archived) {
    if (!entry.isDirectory()) continue
    for (const file of ['proposal.md', 'design.md', 'tasks.md', 'review.md', 'verify.md']) {
      const filePath = join(archiveDir, entry.name, file)
      if (existsSync(filePath)) result.push(filePath.replace(`${root}/`, ''))
    }
  }
  return result.sort()
}

async function readTree(root) {
  const files = await listRelativeFiles(root)
  const map = {}
  for (const rel of files) {
    map[rel] = await readFile(join(root, rel), 'utf8')
  }
  return map
}

describe('Change API/CLI parity', () => {
  let apiRoot
  let cliRoot

  beforeEach(async () => {
    apiRoot = await mkdtemp(join(tmpdir(), 'sf-change-api-'))
    cliRoot = await mkdtemp(join(tmpdir(), 'sf-change-cli-'))
    await makeProject(apiRoot)
    await makeProject(cliRoot)
  })

  afterEach(async () => {
    await rm(apiRoot, { recursive: true, force: true })
    await rm(cliRoot, { recursive: true, force: true })
  })

  test('API and CLI produce the same change artifacts', async () => {
    const apiNew = await change.new(apiRoot, 'Add Auth')
    const cliNew = runCli(cliRoot, ['change', 'new', 'Add Auth'])
    assert.equal(cliNew.status, 0)
    assert.ok(apiNew.slug)
    assert.deepStrictEqual(await readTree(apiRoot), await readTree(cliRoot))

    const apiReview = await change.review(apiRoot, 'add-auth')
    const cliReview = runCli(cliRoot, ['change', 'review', 'add-auth'])
    assert.equal(cliReview.status, 0)
    assert.equal(apiReview.created, true)
    assert.deepStrictEqual(await readTree(apiRoot), await readTree(cliRoot))

    const apiVerify = await change.verify(apiRoot, 'add-auth')
    const cliVerify = runCli(cliRoot, ['change', 'verify', 'add-auth'])
    assert.equal(cliVerify.status, 0)
    assert.equal(apiVerify.created, true)
    assert.deepStrictEqual(await readTree(apiRoot), await readTree(cliRoot))

    const apiVerifyPath = join(apiRoot, '.specfuse', 'changes', 'add-auth', 'verify.md')
    const cliVerifyPath = join(cliRoot, '.specfuse', 'changes', 'add-auth', 'verify.md')
    await writeFile(apiVerifyPath, '---\nstatus: pass\n---\n\n# Verify\n\n- [x] confirmed: Done\n')
    await writeFile(cliVerifyPath, '---\nstatus: pass\n---\n\n# Verify\n\n- [x] confirmed: Done\n')

    const apiArchive = await change.archive(apiRoot, 'add-auth')
    const cliArchive = runCli(cliRoot, ['change', 'archive', 'add-auth'])
    assert.equal(cliArchive.status, 0)
    assert.ok(apiArchive.archiveDir.includes('archive'))
    assert.deepStrictEqual(await readTree(apiRoot), await readTree(cliRoot))
  })
})


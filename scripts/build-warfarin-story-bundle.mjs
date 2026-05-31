#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { WarfarinStorySearchService } from '../lib/services/warfarin-story-search.js'

const language = process.env.STORY_LANGUAGE || 'cn'
const repository = process.env.GITHUB_REPOSITORY || 'yabo083/koishi-plugin-miyako-intel'
const releaseTag = process.env.STORY_RELEASE_TAG || 'warfarin-story-latest'
const outDir = resolve(process.argv[2] || 'artifacts/warfarin-story')
const filename = `warfarin-story-${language}.json.gz`
const manifestName = `warfarin-story-${language}.manifest.json`
const workDir = await mkdtemp(join(tmpdir(), 'miyako-warfarin-story-'))

const service = new WarfarinStorySearchService({
  baseDir: workDir,
  dataDirectory: 'story-cache',
  language,
  rateLimitMs: Number(process.env.STORY_UPDATE_RATE_LIMIT_MS || 500),
  timeoutMs: Number(process.env.STORY_UPDATE_TIMEOUT_MS || 30000),
  batchSize: 0,
  refreshExistingDays: 0,
  refreshExistingBatchSize: 0,
})

const report = await service.update()
const anchorsDir = join(workDir, 'story-cache', language, 'anchors')
const anchors = []
for (const file of (await readdir(anchorsDir)).filter((item) => item.endsWith('.json')).sort()) {
  anchors.push(JSON.parse(await readFile(join(anchorsDir, file), 'utf8')))
}

if (!anchors.length) throw new Error('No Warfarin story text anchors were generated.')

const compressed = gzipSync(JSON.stringify(anchors), { level: 9 })
const sha256 = createHash('sha256').update(compressed).digest('hex')
const url = `https://github.com/${repository}/releases/download/${releaseTag}/${filename}`
const manifest = {
  schemaVersion: 1,
  language,
  count: anchors.length,
  updatedAt: new Date().toISOString(),
  sha256,
  filename,
  url,
  source: 'warfarin.wiki',
  sourceReport: report,
}

await mkdir(outDir, { recursive: true })
await writeFile(join(outDir, filename), compressed)
await writeFile(join(outDir, manifestName), JSON.stringify(manifest, null, 2))
console.log(JSON.stringify({ outDir, filename, manifestName, count: anchors.length, sha256 }, null, 2))

#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { createWarfarinAnchorsFromDetail } from '../lib/services/warfarin-story-search.js'

const rawRoot = resolve(process.argv[2] || 'E:/Codes/Crawler/warfarin_backend/EF-textsearcher/src/data/warfarin')
const outFile = resolve(process.argv[3] || 'src/services/warfarin-story-seed.ts')
const parserVersion = 3
const categories = [
  'documents', 'missions', 'baker', 'tutorials',
  'operators', 'weapons', 'enemies', 'facilities',
  'items', 'gear', 'medals', 'lorev2',
]

const anchors = []
for (const category of categories) {
  const dir = join(rawRoot, category)
  if (!existsSync(dir)) continue
  for (const file of readdirSync(dir).filter(name => name.endsWith('.json')).sort()) {
    const slug = basename(file, '.json')
    const raw = readFileSync(join(dir, file), 'utf8')
    const data = JSON.parse(raw)
    const rawSha256 = createHash('sha256').update(JSON.stringify(data)).digest('hex')
    const sourceKey = `${normalizeScope(category)}/${slug}`
    for (const anchor of createWarfarinAnchorsFromDetail(category, slug, data)) {
      anchors.push({ ...anchor, source_key: sourceKey, raw_sha256: rawSha256 })
    }
  }
}

const payload = JSON.stringify(anchors)
const base64 = gzipSync(payload, { level: 9 }).toString('base64')
const chunks = base64.match(/.{1,100}/g) || []
const body = [
  'import { gunzipSync } from "node:zlib"',
  '',
  'export const bundledStorySeedLanguage = "cn"',
  `export const bundledStorySeedVersion = ${parserVersion}`,
  `export const bundledStorySeedCount = ${anchors.length}`,
  'const bundledStorySeedChunks = [',
  ...chunks.map(chunk => `  "${chunk}",`),
  ']',
  '',
  'export function loadBundledStorySeed() {',
  '  return JSON.parse(gunzipSync(Buffer.from(bundledStorySeedChunks.join(""), "base64")).toString("utf8"))',
  '}',
  '',
].join('\n')

writeFileSync(outFile, body)
console.log(JSON.stringify({ count: anchors.length, gzipBytes: Buffer.byteLength(base64, 'base64'), base64Length: base64.length }, null, 2))

function normalizeScope(category) {
  const scope = String(category || '').trim().toLowerCase()
  return scope === 'lorev2' ? 'lore' : scope
}

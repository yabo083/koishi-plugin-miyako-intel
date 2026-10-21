// One-off repair: re-fetch operator details with the section-based parser and swap the
// operator anchors inside the published story bundle. Usage: node patch-operator-anchors.cjs <workDir>
const { execFile } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { gzipSync, gunzipSync } = require('node:zlib')
const { createWarfarinAnchorsFromDetail } = require('./warfarin-story-parsers.js')

const work = path.resolve(process.argv[2] || '.')
const proxy = process.env.PATCH_PROXY || 'http://127.0.0.1:7890'
const base = 'https://api.warfarin.wiki/v1/cn'
const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const bundlePath = path.join(work, 'in', 'warfarin-story-cn.json.gz')
const manifestPath = path.join(work, 'in', 'warfarin-story-cn.manifest.json')
const slugsPath = path.join(work, 'in', 'operator-slugs.json')
const outDir = path.join(work, 'out')

function curlJson(url) {
  return new Promise((resolve, reject) => {
    execFile('curl', ['-sS', '--compressed', '--max-time', '120', '-x', proxy, '-H', `User-Agent: ${ua}`, '-H', 'Accept: application/json', url], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(`${url} ${error.message} ${String(stderr || '').trim()}`))
      try {
        resolve(JSON.parse(stdout))
      } catch (parseError) {
        reject(new Error(`${url} bad json: ${parseError.message}`))
      }
    })
  })
}

async function fetchDetail(slug, attempt = 1) {
  try {
    const payload = await curlJson(`${base}/operators/${encodeURIComponent(slug)}`)
    const data = payload?.data || payload
    if (!data?.characterTable && !data?.itemTable) throw new Error('empty operator payload')
    return data
  } catch (error) {
    if (attempt >= 3) throw error
    await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
    return fetchDetail(slug, attempt + 1)
  }
}

async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index], index)
      process.stdout.write(`  ${index + 1}/${items.length} ${items[index]}\n`)
    }
  }))
  return results
}

async function main() {
  const anchors = JSON.parse(gunzipSync(fs.readFileSync(bundlePath)).toString('utf8'))
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const slugPayload = JSON.parse(fs.readFileSync(slugsPath, 'utf8'))
  const slugs = (Array.isArray(slugPayload) ? slugPayload : Array.isArray(slugPayload?.data) ? slugPayload.data : [])
    .map(item => String(item?.slug || item || '').trim())
    .filter(Boolean)
  const before = anchors.filter(anchor => anchor.scope === 'operators')
  console.log(`bundle=${anchors.length} anchors, operators=${before.length}, slugs=${slugs.length}`)

  const rebuilt = await mapPool(slugs, 3, async (slug) => {
    const data = await fetchDetail(slug)
    const [anchor] = createWarfarinAnchorsFromDetail('operators', slug, data)
    if (/\[object Object\]/.test(anchor.content)) throw new Error(`${slug} still stringifies objects`)
    if (!anchor.content.includes('\n\n')) throw new Error(`${slug} has no sections`)
    return { ...anchor, source_key: `operators/${slug}`, raw_sha256: createHash('sha256').update(JSON.stringify(data)).digest('hex') }
  })

  const byId = new Map(rebuilt.map(anchor => [anchor.anchor_id, anchor]))
  let replaced = 0
  const patched = anchors.map((anchor) => {
    if (anchor.scope !== 'operators') return anchor
    const next = byId.get(anchor.anchor_id)
    if (!next) return anchor
    replaced++
    return next
  })
  if (replaced !== before.length) throw new Error(`replaced ${replaced} of ${before.length} operator anchors`)
  if (patched.some(anchor => /\[object Object\]/.test(anchor.content || ''))) throw new Error('bundle still contains [object Object]')

  const compressed = gzipSync(JSON.stringify(patched), { level: 9 })
  const sha256 = createHash('sha256').update(compressed).digest('hex')
  const entryByKey = new Map(rebuilt.map(anchor => [anchor.source_key, anchor.raw_sha256]))
  const seen = new Set()
  const entries = (manifest.entries || []).map((entry) => {
    if (!entryByKey.has(entry.key)) return entry
    seen.add(entry.key)
    return { key: entry.key, rawSha256: entryByKey.get(entry.key) }
  })
  for (const [key, rawSha256] of entryByKey) {
    if (!seen.has(key)) entries.push({ key, rawSha256 })
  }
  const nextManifest = { ...manifest, parserVersion: 6, count: patched.length, updatedAt: new Date().toISOString(), sha256, entries }

  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, 'warfarin-story-cn.json.gz'), compressed)
  fs.writeFileSync(path.join(outDir, 'warfarin-story-cn.manifest.json'), JSON.stringify(nextManifest, null, 2))

  const lengths = rebuilt.map(anchor => anchor.content.length).sort((a, b) => b - a)
  console.log(JSON.stringify({ count: patched.length, operators: rebuilt.length, replaced, sha256, longestOperatorContent: lengths[0], over5000: lengths.filter(n => n > 5000).length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

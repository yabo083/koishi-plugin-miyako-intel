const assert = require('node:assert/strict')
const fs = require('node:fs')
const { gunzipSync } = require('node:zlib')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')

const rootDir = path.resolve(__dirname, '..')
const builtFile = path.join(rootDir, 'lib', 'services', 'cache.js')

function loadCacheModule() {
  delete require.cache[builtFile]
  return require(builtFile)
}

test('cache diagnostics expose actual root and current day status', async () => {
  const { DailyImageCache } = loadCacheModule()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-cache-diag-'))
  const cache = new DailyImageCache(baseDir, 'data/miyako-intel/cache', 'Asia/Shanghai', 4, () => new Date('2026-05-14T08:00:00.000+08:00'))
  const todayDir = path.join(baseDir, 'data/miyako-intel/cache', '2026-05-14')
  fs.mkdirSync(todayDir, { recursive: true })
  fs.writeFileSync(path.join(todayDir, 'daily.png'), Buffer.from('today'))

  const diagnostics = await cache.inspect('daily')

  assert.equal(diagnostics.baseDir, baseDir)
  assert.equal(diagnostics.currentDayKey, '2026-05-14')
  assert.equal(diagnostics.todayExists, true)
  assert.equal(diagnostics.latestDayKey, '2026-05-14')
  assert.equal(diagnostics.dayKeys.length, 1)
  assert.match(diagnostics.cacheRoot, /data[\\/]miyako-intel[\\/]cache$/)
})

test('cache maintenance archives old day directories and keeps recent days', async () => {
  const { DailyImageCache } = loadCacheModule()
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'miyako-cache-maintain-'))
  const cacheRoot = path.join(baseDir, 'data/miyako-intel/cache')
  for (let day = 1; day <= 10; day += 1) {
    const dayKey = `2026-05-${String(day).padStart(2, '0')}`
    const dir = path.join(cacheRoot, dayKey)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'daily.png'), Buffer.from(`image-${dayKey}`))
    fs.writeFileSync(path.join(dir, 'daily.json'), JSON.stringify({ kind: 'daily', dayKey, generatedAt: '2026-05-14T00:00:00.000Z', sourceUrls: [] }))
  }

  const cache = new DailyImageCache(baseDir, 'data/miyako-intel/cache', 'Asia/Shanghai', 4, () => new Date('2026-05-14T08:00:00.000+08:00'))

  const report = await cache.maintain({
    enabled: true,
    keepRecentDays: 7,
    archiveEnabled: true,
    archiveDirectory: 'archives',
    deleteAfterArchive: true,
  })

  assert.equal(report.archivedDayKeys.length, 3)
  assert.deepEqual(report.deletedDayKeys, ['2026-05-01', '2026-05-02', '2026-05-03'])
  assert.equal(fs.existsSync(path.join(cacheRoot, '2026-05-01')), false)
  assert.equal(fs.existsSync(path.join(cacheRoot, '2026-05-04')), true)

  const archivePath = path.join(cacheRoot, 'archives', 'miyako-intel-cache-2026-05.json.gz')
  const archive = JSON.parse(gunzipSync(fs.readFileSync(archivePath)).toString('utf8'))
  assert.equal(archive.version, 1)
  assert.equal(archive.days['2026-05-01'].files['daily.png'].encoding, 'base64')
  assert.equal(Buffer.from(archive.days['2026-05-01'].files['daily.png'].content, 'base64').toString(), 'image-2026-05-01')
})

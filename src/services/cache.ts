import fs from 'node:fs/promises'
import path from 'node:path'
import { gzip, gunzip } from 'node:zlib'
import { promisify } from 'node:util'
import { CacheMaintenanceConfig, CacheManifest, CaptureKind } from '../types'
import { getPrtsDayKey } from '../core/time'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

/** 归档保留策略的默认值：留最近 7 天，更早的按月打包成 gz 后删掉原目录 */
export const DEFAULT_CACHE_MAINTENANCE = {
  enabled: true,
  keepRecentDays: 7,
  archiveEnabled: true,
  archiveDirectory: 'archives',
  archiveCron: '30 4 * * *',
  deleteAfterArchive: true,
}

export class DailyImageCache {
  constructor(
    private readonly baseDir: string,
    private readonly cacheDirectory: string,
    private readonly timezone: string,
    private readonly refreshHour: number,
    private readonly nowProvider: () => Date = () => new Date(),
  ) {}

  get currentDayKey() {
    return getPrtsDayKey(this.nowProvider(), this.timezone, this.refreshHour)
  }

  get rootDirectory() {
    return this.rootDir
  }

  getImagePath(kind: CaptureKind, dayKey = this.currentDayKey) {
    return path.join(this.rootDir, dayKey, `${kind}.png`)
  }

  getManifestPath(kind: CaptureKind, dayKey = this.currentDayKey) {
    return path.join(this.rootDir, dayKey, `${kind}.json`)
  }

  async hasToday(kind: CaptureKind) {
    return this.exists(this.getImagePath(kind))
  }

  async inspect(kind: CaptureKind = 'daily') {
    const dayKeys = await this.listDayKeys()
    const latestDayKey = dayKeys[0] || ''
    return {
      baseDir: this.baseDir,
      cacheRoot: this.rootDir,
      currentDayKey: this.currentDayKey,
      todayExists: await this.hasToday(kind),
      latestDayKey,
      dayKeys,
    }
  }

  async maintain(options: CacheMaintenanceConfig) {
    const empty = {
      enabled: options.enabled,
      keptDayKeys: [] as string[],
      archivedDayKeys: [] as string[],
      deletedDayKeys: [] as string[],
      archiveFiles: [] as string[],
    }
    if (!options.enabled) return empty

    const dayKeys = await this.listDayKeys()
    const keepCount = Math.max(1, options.keepRecentDays)
    const keptDayKeys = dayKeys.slice(0, keepCount)
    const staleDayKeys = dayKeys.slice(keepCount)
    if (!staleDayKeys.length) return { ...empty, keptDayKeys }

    const archiveFiles: string[] = []
    const archivedDayKeys: string[] = []
    if (options.archiveEnabled) {
      const groups = groupByMonth(staleDayKeys)
      const archiveRoot = path.resolve(this.rootDir, options.archiveDirectory || 'archives')
      await fs.mkdir(archiveRoot, { recursive: true })
      for (const [monthKey, keys] of groups) {
        const archivePath = path.join(archiveRoot, `miyako-intel-cache-${monthKey}.json.gz`)
        const archive = await this.readArchive(archivePath)
        archive.updatedAt = this.nowProvider().toISOString()
        for (const dayKey of keys) {
          archive.days[dayKey] = await this.readDayArchive(dayKey)
          archivedDayKeys.push(dayKey)
        }
        await fs.writeFile(archivePath, await gzipAsync(Buffer.from(JSON.stringify(archive, null, 2))))
        archiveFiles.push(archivePath)
      }
    }

    const canDelete = options.deleteAfterArchive && (!options.archiveEnabled || archivedDayKeys.length === staleDayKeys.length)
    const deletedDayKeys: string[] = []
    if (canDelete) {
      for (const dayKey of staleDayKeys) {
        await fs.rm(path.join(this.rootDir, dayKey), { recursive: true, force: true })
        deletedDayKeys.push(dayKey)
      }
    }

    return {
      enabled: true,
      keptDayKeys,
      archivedDayKeys: archivedDayKeys.sort(),
      deletedDayKeys: deletedDayKeys.sort(),
      archiveFiles,
    }
  }

  async readToday(kind: CaptureKind) {
    const dayKey = this.currentDayKey
    const filePath = this.getImagePath(kind, dayKey)
    if (!await this.exists(filePath)) return null
    const manifest = await this.readManifest(kind, dayKey)
    return {
      buffer: await fs.readFile(filePath),
      dayKey,
      filePath,
      mimeType: manifest?.mimeType,
    }
  }

  async write(kind: CaptureKind, buffer: Buffer, manifest: Omit<CacheManifest, 'kind' | 'dayKey' | 'generatedAt'>) {
    const dayKey = this.currentDayKey
    const dir = path.join(this.rootDir, dayKey)
    await fs.mkdir(dir, { recursive: true })

    const filePath = this.getImagePath(kind, dayKey)
    await fs.writeFile(filePath, buffer)
    await fs.writeFile(this.getManifestPath(kind, dayKey), JSON.stringify({
      kind,
      dayKey,
      generatedAt: this.nowProvider().toISOString(),
      ...manifest,
    } satisfies CacheManifest, null, 2))

    return {
      buffer,
      dayKey,
      filePath,
      mimeType: manifest.mimeType,
    }
  }

  private get rootDir() {
    return path.resolve(this.baseDir, this.cacheDirectory)
  }

  private async exists(filePath: string) {
    try {
      await fs.access(filePath)
      return true
    } catch {
      return false
    }
  }

  private async readManifest(kind: CaptureKind, dayKey: string) {
    const filePath = this.getManifestPath(kind, dayKey)
    try {
      return JSON.parse(await fs.readFile(filePath, 'utf8')) as CacheManifest
    } catch {
      return null
    }
  }

  private async listDayKeys() {
    if (!await this.exists(this.rootDir)) return []
    const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse()
  }

  private async readDayArchive(dayKey: string) {
    const dir = path.join(this.rootDir, dayKey)
    const entries = await fs.readdir(dir, { withFileTypes: true })
    const files: Record<string, { encoding: 'base64'; content: string }> = {}
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const filePath = path.join(dir, entry.name)
      files[entry.name] = {
        encoding: 'base64',
        content: (await fs.readFile(filePath)).toString('base64'),
      }
    }
    return { archivedAt: this.nowProvider().toISOString(), files }
  }

  private async readArchive(filePath: string): Promise<CacheArchive> {
    try {
      return JSON.parse((await gunzipAsync(await fs.readFile(filePath))).toString('utf8')) as CacheArchive
    } catch {
      return { version: 1, updatedAt: this.nowProvider().toISOString(), days: {} }
    }
  }
}

interface CacheArchive {
  version: 1
  updatedAt: string
  days: Record<string, { archivedAt: string; files: Record<string, { encoding: 'base64'; content: string }> }>
}

function groupByMonth(dayKeys: string[]) {
  const result = new Map<string, string[]>()
  for (const dayKey of dayKeys) {
    const monthKey = dayKey.slice(0, 7)
    const group = result.get(monthKey) || []
    group.push(dayKey)
    result.set(monthKey, group)
  }
  return result
}

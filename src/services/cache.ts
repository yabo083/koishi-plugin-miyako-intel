import fs from 'node:fs/promises'
import path from 'node:path'
import { CacheManifest, CaptureKind } from '../types'

export function getPrtsDayKey(date = new Date(), timezone = 'Asia/Shanghai', refreshHour = 4): string {
  const parts = getZonedParts(date, timezone)
  let year = parts.year
  let month = parts.month
  let day = parts.day

  if (parts.hour < refreshHour) {
    const previous = new Date(Date.UTC(year, month - 1, day) - 24 * 60 * 60 * 1000)
    year = previous.getUTCFullYear()
    month = previous.getUTCMonth() + 1
    day = previous.getUTCDate()
  }

  return `${year}-${pad2(month)}-${pad2(day)}`
}

export function getZonedParts(date: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })

  const values = new Map<string, string>()
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values.set(part.type, part.value)
  }

  return {
    year: Number(values.get('year')),
    month: Number(values.get('month')),
    day: Number(values.get('day')),
    hour: Number(values.get('hour')),
    minute: Number(values.get('minute')),
  }
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

  getImagePath(kind: CaptureKind, dayKey = this.currentDayKey) {
    return path.join(this.rootDir, dayKey, `${kind}.png`)
  }

  getManifestPath(kind: CaptureKind, dayKey = this.currentDayKey) {
    return path.join(this.rootDir, dayKey, `${kind}.json`)
  }

  async hasToday(kind: CaptureKind) {
    return this.exists(this.getImagePath(kind))
  }

  async readToday(kind: CaptureKind) {
    const dayKey = this.currentDayKey
    const filePath = this.getImagePath(kind, dayKey)
    if (!await this.exists(filePath)) return null
    return { buffer: await fs.readFile(filePath), stale: false, dayKey, filePath }
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

    return { buffer, stale: false, dayKey, filePath }
  }

  async readLatest(kind: CaptureKind) {
    if (!await this.exists(this.rootDir)) return null

    const entries = await fs.readdir(this.rootDir, { withFileTypes: true })
    const dayKeys = entries
      .filter((entry) => entry.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse()

    for (const dayKey of dayKeys) {
      const filePath = this.getImagePath(kind, dayKey)
      if (await this.exists(filePath)) {
        return { buffer: await fs.readFile(filePath), stale: dayKey !== this.currentDayKey, dayKey, filePath }
      }
    }

    return null
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
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

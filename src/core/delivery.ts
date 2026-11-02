// 共享投递服务（miyako-delivery）的结构化桥接层。
// 本插件只是投递服务的一个业务方：服务缺席时所有调用点都必须回落到内置路径，
// 所以这里只认「方法存在且形状对得上」的部分，绝不把服务对象本身泄漏出去。
import { Context } from 'koishi'

const SERVICE_NAME = 'miyako-delivery'

/** 频道目标：`platform:cid`，私聊形如 `onebot:private:1000` */
export interface DeliveryChannelTarget {
  kind?: 'channel'
  channelId: string
  silent?: boolean
}

/** 群相册目标：`platform:group_id` + 相册 ID（名称缺省由服务端反查） */
export interface DeliveryAlbumTarget {
  kind: 'album'
  channelId: string
  albumId: string
  albumName?: string
  silent?: boolean
}

export type DeliveryTarget = DeliveryChannelTarget | DeliveryAlbumTarget

export interface DeliveryError {
  code: string
  message: string
  retryable?: boolean
}

/** 投递项形状与全局契约一致 */
export interface DeliveryItem {
  target: DeliveryTarget
  elements: readonly unknown[]
  scope?: string
  dedupeKey?: string
  dedupeWindowMs?: number
}

export type DeliverySkipReason = 'duplicate' | 'quiet-hours' | 'no-available-bot'

export interface DeliveryOutcome {
  target?: DeliveryTarget
  /** 错误以外的终局都为 true；`skipped` 属于「无需投递」，不算失败 */
  ok: boolean
  skipped?: DeliverySkipReason
  messageId?: string
  error?: DeliveryError
  attempts?: number
}

export interface DeliveryResult {
  ok: boolean
  deliveredCount: number
  totalCount: number
  outcomes: readonly DeliveryOutcome[]
}

export interface DeliveryAlbumInfo {
  groupId?: string
  groupName?: string
  albumId: string
  albumName?: string
}

/** 本插件用到的服务面；只有 `gateDailySlot` 是必需的，其余按能力探测 */
export interface DeliveryCronOptions {
  /** IANA 时区；缺省为宿主本地 */
  timeZone?: string
}

export interface DeliveryHandle {
  /** 先落盘再返回 true：同一 slot + dayKey 只有第一次放行 */
  gateDailySlot(slot: string, dayKey: string): Promise<boolean>
  /** 注册 cron 定时任务（表达式由本插件配置提供，调度引擎在投递服务） */
  scheduleCron(expression: string, run: () => void | Promise<unknown>, options?: DeliveryCronOptions): () => void
  deliver?(delivery: DeliveryItem): Promise<DeliveryOutcome>
  broadcast?(deliveries: readonly DeliveryItem[]): Promise<DeliveryResult>
  listAlbums?(groupId: string): Promise<DeliveryAlbumInfo[]>
}

type RawMethod = (...args: readonly unknown[]) => Promise<unknown>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readMethod(source: Record<string, unknown>, key: string): RawMethod | undefined {
  const value = source[key]
  return typeof value === 'function' ? value.bind(source) as RawMethod : undefined
}

function readSkipReason(value: unknown): DeliverySkipReason | undefined {
  return value === 'duplicate' || value === 'quiet-hours' || value === 'no-available-bot' ? value : undefined
}

function normalizeTarget(value: unknown): DeliveryTarget | undefined {
  if (!isRecord(value)) return undefined
  const channelId = readString(value.channelId)
  if (!channelId) return undefined
  const silent = value.silent === true
  const albumId = readString(value.albumId)
  if (value.kind === 'album') {
    if (!albumId) return undefined
    const target: DeliveryAlbumTarget = { kind: 'album', channelId, albumId }
    const albumName = readString(value.albumName)
    if (albumName) target.albumName = albumName
    if (silent) target.silent = true
    return target
  }
  const target: DeliveryChannelTarget = { channelId }
  if (silent) target.silent = true
  return target
}

function normalizeError(value: unknown): DeliveryError | undefined {
  if (!isRecord(value)) return undefined
  return {
    code: readString(value.code) ?? 'UNKNOWN',
    message: readString(value.message) ?? '',
    ...(typeof value.retryable === 'boolean' ? { retryable: value.retryable } : {}),
  }
}

function normalizeOutcome(value: unknown): DeliveryOutcome {
  if (!isRecord(value)) {
    return { ok: false, error: { code: 'INVALID_PAYLOAD', message: '投递服务返回了无法识别的结果' } }
  }
  const outcome: DeliveryOutcome = { ok: value.ok === true }
  const target = normalizeTarget(value.target)
  if (target) outcome.target = target
  const skipped = readSkipReason(value.skipped)
  if (skipped) outcome.skipped = skipped
  const messageId = readString(value.messageId)
  if (messageId) outcome.messageId = messageId
  const error = normalizeError(value.error)
  if (error) outcome.error = error
  const attempts = readNumber(value.attempts)
  if (attempts !== undefined) outcome.attempts = attempts
  if (!outcome.ok && !outcome.skipped && !outcome.error) {
    outcome.error = { code: 'UNKNOWN', message: '投递失败但未返回错误信息' }
  }
  return outcome
}

function normalizeResult(value: unknown): DeliveryResult {
  if (!isRecord(value) || !Array.isArray(value.outcomes)) {
    const outcome = normalizeOutcome(undefined)
    return { ok: false, deliveredCount: 0, totalCount: 0, outcomes: [outcome] }
  }
  const outcomes = value.outcomes.map(normalizeOutcome)
  return {
    ok: value.ok === true,
    deliveredCount: readNumber(value.deliveredCount) ?? outcomes.filter((outcome) => outcome.ok).length,
    totalCount: readNumber(value.totalCount) ?? outcomes.length,
    outcomes,
  }
}

function normalizeAlbums(value: unknown): DeliveryAlbumInfo[] {
  if (!Array.isArray(value)) return []
  const albums: DeliveryAlbumInfo[] = []
  for (const item of value) {
    if (!isRecord(item)) continue
    const albumId = readString(item.albumId)
    if (!albumId) continue
    const album: DeliveryAlbumInfo = { albumId }
    const albumName = readString(item.albumName)
    if (albumName) album.albumName = albumName
    const groupId = readString(item.groupId)
    if (groupId) album.groupId = groupId
    const groupName = readString(item.groupName)
    if (groupName) album.groupName = groupName
    albums.push(album)
  }
  return albums
}

/**
 * 读宿主上的 `miyako-delivery` 服务。
 *
 * 调度、日切水位与投递已经全部下沉到该服务，因此它是本插件的**硬依赖**；
 * 服务缺失或形状不认识时直接抛错，让加载失败而不是带着残缺能力运行。
 */
export function requireDelivery(ctx: Context): DeliveryHandle {
  const raw = (ctx as unknown as Record<string, unknown>)[SERVICE_NAME]
  if (!isRecord(raw)) {
    throw new Error("miyako-intel 依赖 ctx['miyako-delivery'] 服务：请在实例中加载 koishi-plugin-miyako-delivery")
  }
  const gateDailySlot = readMethod(raw, 'gateDailySlot')
  if (!gateDailySlot) {
    throw new Error("miyako-delivery 服务缺少 gateDailySlot：版本过旧？请升级到 >= 0.3.0")
  }
  const scheduleCronRaw = raw.scheduleCron
  if (typeof scheduleCronRaw !== 'function') {
    throw new Error("miyako-delivery 服务缺少 scheduleCron：版本过旧？请升级到 >= 0.3.0")
  }

  const deliver = readMethod(raw, 'deliver')
  const broadcast = readMethod(raw, 'broadcast')
  const listAlbums = readMethod(raw, 'listAlbums')

  const handle: DeliveryHandle = {
    async gateDailySlot(slot, dayKey) {
      return (await gateDailySlot(slot, dayKey)) === true
    },
    scheduleCron(expression, run, options) {
      const stop: unknown = scheduleCronRaw.call(raw, expression, run, options)
      return typeof stop === 'function' ? stop as () => void : () => undefined
    },
  }
  if (deliver) handle.deliver = async (item) => normalizeOutcome(await deliver(item))
  if (broadcast) handle.broadcast = async (items) => normalizeResult(await broadcast(items))
  if (listAlbums) handle.listAlbums = async (groupId) => normalizeAlbums(await listAlbums(groupId))
  return handle
}

// 群相册（SnowLuma OneBot 扩展）：探测 bot 所在群的相册供配置选择 + 上传长图切片
// SnowLuma 只有 list + upload 两个相册动作，建不了相册——WebUI 里选的必须已经存在。
import { Context, h, Schema } from 'koishi'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { ScopedLogger } from '../core/logger'
import { formatError } from '../core/errors'
import { DeliveryHandle } from '../core/delivery'
import { Config as RuntimeConfig } from '../types'

const ALBUM_PAGE_LIMIT = 5
export const ALBUM_SCHEMA_KEY = 'miyako-intel.album'

export interface DetectedAlbum {
  groupId: string
  groupName: string
  albumId: string
  albumName: string
  selfId: string
}

export interface AlbumHubDeps {
  ctx: Context
  wiki: RuntimeConfig['wiki']
  logger: ScopedLogger
  /** stats 目录（queries.json 旁边） */
  statsDirectory: string
  /** scheduledPush.channels：只探测这些频道对应的群 */
  pushChannels: () => string[]
  /** 共享投递服务（硬依赖）：相册上传走它的 kind:'album' 目标 */
  delivery: DeliveryHandle
}

type OneBotGet = (action: string, params: Record<string, unknown>) => Promise<any>

function boundGet(bot: any): OneBotGet | undefined {
  const internal = bot?.internal
  return typeof internal?._get === 'function' ? internal._get.bind(internal) as OneBotGet : undefined
}

function albumsFilePath(statsDirectory: string) {
  return join(statsDirectory, 'albums.json')
}

export async function readAlbumsCache(statsDirectory: string): Promise<DetectedAlbum[]> {
  try {
    const payload = JSON.parse(await readFile(albumsFilePath(statsDirectory), 'utf8')) as unknown
    return Array.isArray(payload) ? payload as DetectedAlbum[] : []
  } catch {
    return []
  }
}

/** 配置项的候选 union：探测结果 + 已配置但探测不到的项兜底；都没有就放个占位提示 */
export function albumSchemaUnion(albums: DetectedAlbum[], configured: string[]) {
  const items: Schema<any>[] = albums.map((album) => Schema.const(`${album.groupId}/${album.albumId}`)
    .description(`${album.groupName || album.groupId}（${album.groupId}）/ ${album.albumName || album.albumId}`))
  for (const value of configured || []) {
    if (!value || albums.some((album) => `${album.groupId}/${album.albumId}` === value)) continue
    items.push(Schema.const(value).description(`${value}（未探测到）`))
  }
  if (!items.length) items.push(Schema.const('').description('尚未探测到相册：确认 scheduledPush.channels 已填群、机器人在线、群内已建相册'))
  return Schema.union(items)
}

/** scheduledPush.channels 的 'onebot:123' / 'onebot:group:123' / '123' → 群号；非 onebot 条目丢弃 */
export function channelGroupId(channel: unknown) {
  const text = String(channel || '').trim()
  if (/^\d+$/.test(text)) return text
  const match = text.match(/^onebot:(?:group:)?(\d+)$/i)
  return match ? match[1] : ''
}

export function createAlbumHub(deps: AlbumHubDeps) {
  const { ctx, wiki, logger, statsDirectory, pushChannels, delivery } = deps
  /** 群号 → 所属 bot（探测过一次后缓存） */
  const groupBots = new Map<string, any>()
  /** 上传时解析到的相册名也存一份，通知/预览不必再查一次相册列表 */
  const albumNames = new Map<string, string>()
  let cachedAlbums: DetectedAlbum[] | undefined

  function oneBotBots() {
    const bots: any[] = []
    for (const bot of ctx.bots as any || []) {
      if (bot?.platform === 'onebot' && boundGet(bot)) bots.push(bot)
    }
    return bots
  }

  async function groupNameOf(get: OneBotGet, groupId: string) {
    try {
      const payload = await get('get_group_info', { group_id: normalizeGroupId(groupId) })
      return String(payload?.group_name ?? payload?.data?.group_name ?? '')
    } catch {
      return ''
    }
  }

  /** 只探测 scheduledPush.channels 里的群：逐群试各 bot 的相册列表，成功的那个认主 */
  async function detectAlbums(): Promise<DetectedAlbum[]> {
    const found: DetectedAlbum[] = []
    const groupIds = [...new Set((pushChannels() || []).map(channelGroupId).filter(Boolean))]
    const bots = oneBotBots()
    for (const groupId of groupIds) {
      const known = groupBots.get(groupId)
      const candidates = known ? [known, ...bots.filter((bot) => bot !== known)] : bots
      let resolved = false
      for (const bot of candidates) {
        const get = boundGet(bot)!
        try {
          const albums: any[] = []
          let attachInfo: unknown
          for (let page = 0; page < ALBUM_PAGE_LIMIT; page++) {
            const payload = await get('get_qun_album_list', {
              group_id: normalizeGroupId(groupId),
              ...(attachInfo ? { attach_info: attachInfo } : {}),
            })
            const retcode = Number(payload?.retcode)
            if (Number.isFinite(retcode) && retcode !== 0) throw new Error(`retcode ${retcode}`)
            const list = payload?.album_list ?? payload?.data?.album_list ?? []
            if (Array.isArray(list)) albums.push(...list)
            if (!payload?.has_more && !payload?.data?.has_more) break
            attachInfo = payload?.attach_info ?? payload?.data?.attach_info
            if (!attachInfo) break
          }
          resolved = true
          groupBots.set(groupId, bot)
          const groupName = await groupNameOf(get, groupId)
          for (const album of albums) {
            if (album?.album_id == null) continue
            found.push({
              groupId,
              groupName,
              albumId: String(album.album_id),
              albumName: String(album.name || album.album_name || ''),
              selfId: String(bot.selfId || ''),
            })
          }
          break
        } catch { /* 这个群不归这个 bot，试下一个 */ }
      }
      if (!candidates.length) logger.warn(`群 ${groupId} 相册探测失败：没有可用的 OneBot bot`)
      else if (!resolved) logger.warn(`群 ${groupId} 相册探测失败：所有 OneBot bot 都查不到该群`)
    }
    cachedAlbums = found
    applySchema(found, wiki.digestAlbums || [])
    await mkdir(dirname(albumsFilePath(statsDirectory)), { recursive: true })
      .then(() => writeFile(albumsFilePath(statsDirectory), JSON.stringify(found), 'utf8'))
      .catch((error) => logger.warn(`群相册列表落盘失败：${formatError(error)}`))
    return found
  }

  function applySchema(albums: DetectedAlbum[], configured: string[]) {
    ctx.schema?.set?.(ALBUM_SCHEMA_KEY, albumSchemaUnion(albums, configured))
  }

  /** 启动时先用缓存的探测结果刷新配置候选项（没有缓存就用空列表，仅兜底已配置值） */
  async function initSchema() {
    cachedAlbums = await readAlbumsCache(statsDirectory)
    applySchema(cachedAlbums, wiki.digestAlbums || [])
  }

  /** 找拥有这个群的 bot；探测不到就退回第一个 OneBot bot */
  async function resolveBot(groupId: string): Promise<any> {
    const cached = groupBots.get(String(groupId))
    if (cached) return cached
    for (const bot of oneBotBots()) {
      const get = boundGet(bot)!
      try {
        const payload = await get('get_group_list', {})
        const list = payload?.group_list ?? payload ?? []
        for (const group of Array.isArray(list) ? list : []) {
          if (group?.group_id != null) groupBots.set(String(group.group_id), bot)
        }
        if (groupBots.get(String(groupId)) === bot) return bot
      } catch { /* 下一个 bot */ }
    }
    return oneBotBots()[0]
  }

  async function albumNameOf(get: OneBotGet, groupId: string, albumId: string) {
    const detected = cachedAlbums?.find((album) => album.groupId === String(groupId) && album.albumId === String(albumId))
    if (detected?.albumName) return detected.albumName
    const payload = await get('get_qun_album_list', { group_id: normalizeGroupId(groupId) })
    const list = payload?.album_list ?? payload?.data?.album_list ?? []
    const album = (Array.isArray(list) ? list : []).find((item: any) => String(item?.album_id) === String(albumId))
    return String(album?.name || album?.album_name || '')
  }

  function normalizeGroupId(groupId: string) {
    const numeric = Number(groupId)
    return Number.isInteger(numeric) && numeric > 0 ? numeric : groupId
  }

  /** 顺序上传切片；整批超时/失败只 warn 返回 false，不往调用方抛 */
  async function uploadImages(groupId: string, albumId: string, images: Buffer[]): Promise<boolean> {
    if (!groupId || !albumId || !images.length) return false
    const deliver = delivery.deliver
    try {
      return await withTimeout((async () => {
        if (deliver) {
          // 共享投递服务接管：逐张按相册目标投递；顺带用它的相册列表补一次相册名缓存，
          // 供群内提示与预览显示（失败只影响文案，不影响上传）
          if (delivery.listAlbums) {
            try {
              const albums = await delivery.listAlbums(groupId)
              const found = albums.find((album) => album.albumId === albumId)
              if (found?.albumName) albumNames.set(`${groupId}/${albumId}`, found.albumName)
            } catch (error) {
              logger.debug(`相册名查询失败（仅影响提示文案）：${formatError(error)}`)
            }
          }
          for (const image of images) {
            const outcome = await deliver({
              target: { kind: 'album', channelId: `onebot:${groupId}`, albumId },
              elements: [h('img', { src: image })],
            })
            if (!outcome.ok) {
              logger.warn(`Warfarin 周报长图上传群相册失败（${groupId}/${albumId}）：${outcome.error?.code ?? 'UNKNOWN'} ${outcome.error?.message ?? '投递未成功'}`.trim())
              return false
            }
          }
          return true
        }
        const bot = await resolveBot(groupId)
        const get = boundGet(bot)
        if (!get) return false
        const albumName = await albumNameOf(get, groupId, albumId)
        if (!albumName) {
          logger.warn(`群 ${groupId} 里没找到相册 ${albumId}，请确认相册名后再试`)
          return false
        }
        albumNames.set(`${groupId}/${albumId}`, albumName)
        const gid = normalizeGroupId(groupId)
        for (const image of images) {
          await get('upload_image_to_qun_album', {
            group_id: gid,
            album_id: albumId,
            album_name: albumName,
            file: `base64://${image.toString('base64')}`,
          })
        }
        return true
      })(), wiki.albumUploadTimeoutMs || 60000)
    } catch (error) {
      logger.warn(`Warfarin 周报长图上传群相册失败（${groupId}/${albumId}）：${formatError(error)}`)
      return false
    }
  }

  /** 把周报提示发进群；用拥有该群的 bot（探测缓存/群列表解析），拿不到就用第一个 */
  async function notifyGroup(groupId: string, text: string) {
    const bot = await resolveBot(groupId)
    if (typeof bot?.sendMessage !== 'function') throw new Error(`bot 不支持 sendMessage（${groupId}）`)
    await bot.sendMessage(String(groupId), text)
  }

  /** 群名或群号（探测缓存里有群名就用群名） */
  function groupLabel(groupId: string) {
    const album = cachedAlbums?.find((item) => item.groupId === String(groupId))
    return album?.groupName ? `${album.groupName}（${groupId}）` : String(groupId)
  }

  /** 相册名或相册 ID */
  function albumLabel(groupId: string, albumId: string) {
    const album = cachedAlbums?.find((item) => item.groupId === String(groupId) && item.albumId === String(albumId))
    return album?.albumName || albumNames.get(`${groupId}/${albumId}`) || String(albumId)
  }

  return { detectAlbums, initSchema, applySchema, uploadImages, notifyGroup, groupLabel, albumLabel }
}

export type AlbumHub = ReturnType<typeof createAlbumHub>

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  const limit = Math.max(5000, ms || 60000)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`album upload timed out after ${limit}ms`)), limit)
    timer.unref?.()
    task.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

// 渲染用 webfont 资源：把 lxgw/志莽/宋体 css+woff2 拷进系统临时目录（按包版本共享），
// 返回可直接拼进 <head> 的 <link rel=stylesheet file://…> 标签串；日报卡片与周报 404 图共用
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { formatError } from '../core/errors'
interface RenderFontsLogger {
  warn: (message: string) => void
  debug?: (message: string) => void
}

const RENDER_FONTS_VERSION = 2
// 「泰拉周刊」正文用 500、标题用 900，宋体四档一起备好
const SERIF_CSS_FILES = [
  'chinese-simplified-400.css',
  'chinese-simplified-500.css',
  'chinese-simplified-700.css',
  'chinese-simplified-900.css',
]

export async function ensureRenderFontsCssLinks(logger?: RenderFontsLogger): Promise<string> {
  try {
    const lxgwDir = path.dirname(require.resolve('lxgw-wenkai-lite-webfont/lxgwwenkailite-regular.css'))
    const zmxDir = path.dirname(require.resolve('@fontsource/zhi-mang-xing/index.css'))
    const serifDir = path.dirname(require.resolve('@fontsource/noto-serif-sc/chinese-simplified-400.css'))
    const version = JSON.stringify({
      version: RENDER_FONTS_VERSION,
      lxgw: readPackageVersion(lxgwDir),
      zmx: readPackageVersion(zmxDir),
      serif: readPackageVersion(serifDir),
    })
    // 字体按版本共享在系统临时目录，多实例/多测试只复制一次
    const hash = createHash('md5').update(version).digest('hex').slice(0, 8)
    const fontsDir = path.join(os.tmpdir(), 'miyako-intel-render-fonts', hash)
    if (!await exists(path.join(fontsDir, 'version.json'))) {
      await fs.rm(fontsDir, { recursive: true, force: true })
      await copyInto(lxgwDir, path.join(fontsDir, 'lxgw'), ['lxgwwenkailite-regular.css', 'lxgwwenkailite-bold.css'])
      await copyInto(zmxDir, path.join(fontsDir, 'zmx'), ['index.css'])
      await copyInto(serifDir, path.join(fontsDir, 'serif'), SERIF_CSS_FILES, /chinese-simplified-[4579]00[^/]*\.woff2$/)
      await fs.writeFile(path.join(fontsDir, 'version.json'), version, 'utf8')
      logger?.debug?.('渲染字体资源已就绪。')
    }
    return [
      'lxgw/lxgwwenkailite-regular.css',
      'lxgw/lxgwwenkailite-bold.css',
      'zmx/index.css',
      ...SERIF_CSS_FILES.map((file) => `serif/${file}`),
    ].map((relative) => `<link rel="stylesheet" href="${pathToFileURL(path.join(fontsDir, relative)).href}">`).join('\n')
  } catch (error) {
    logger?.warn(`渲染字体资源缺失，退化为系统楷体：${formatError(error)}`)
    return ''
  }
}

async function copyInto(sourceDir: string, targetDir: string, files: string[], fileFilter?: RegExp) {
  await fs.mkdir(targetDir, { recursive: true })
  for (const file of files) {
    await fs.copyFile(path.join(sourceDir, file), path.join(targetDir, file))
  }
  const filesDir = path.join(sourceDir, 'files')
  if (!await exists(filesDir)) return
  const targetFilesDir = path.join(targetDir, 'files')
  await fs.mkdir(targetFilesDir, { recursive: true })
  for (const entry of await fs.readdir(filesDir)) {
    if (fileFilter && !fileFilter.test(entry)) continue
    await fs.copyFile(path.join(filesDir, entry), path.join(targetFilesDir, entry))
  }
}

function readPackageVersion(packageDir: string) {
  try {
    return require(path.join(packageDir, 'package.json')).version || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function exists(filePath: string) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

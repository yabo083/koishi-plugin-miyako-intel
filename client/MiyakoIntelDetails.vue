<template>
  <div
    v-if="isOwn"
    data-miyako-intel-nav="1"
    class="miyako-intel-nav"
    :class="{ 'is-collapsed': isCollapsed }"
    :style="positionStyle"
  >
    <div
      class="miyako-intel-nav__header"
      @mousedown="startMove"
      @touchstart="startMove"
    >
      <span class="miyako-intel-nav__grip" aria-hidden="true"></span>
      <strong>miyako-intel</strong>
      <button
        type="button"
        class="miyako-intel-nav__toggle"
        @click="toggleCollapse"
        @mousedown.stop
        @touchstart.stop
      >
        ^
      </button>
    </div>

    <div class="miyako-intel-nav__body">
      <div class="miyako-intel-nav__section">
        <div class="miyako-intel-nav__section-title">配置</div>
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="miyako-intel-nav__item"
          :class="{ 'is-active': activeItem === item.id }"
          @click="scrollTo(item)"
        >
          {{ item.label }}
        </button>
      </div>

      <div class="miyako-intel-nav__section">
        <div class="miyako-intel-nav__section-title">状态</div>
        <div class="miyako-intel-nav__status">
          <span>定时推送</span>
          <strong>{{ pushStatus }}</strong>
        </div>
        <div class="miyako-intel-nav__status">
          <span>PRTS 站点</span>
          <strong>{{ status.sites.prts }}</strong>
        </div>
        <div class="miyako-intel-nav__status">
          <span>官方 API</span>
          <strong>{{ status.sites.warfarin }}</strong>
        </div>
        <div class="miyako-intel-nav__status">
          <span>全文缓存</span>
          <strong>{{ status.sites.story }}</strong>
        </div>
        <div class="miyako-intel-nav__status">
          <span>PRTS 补缓存</span>
          <strong>{{ status.cache.refreshCron }}</strong>
        </div>
        <div class="miyako-intel-nav__status">
          <span>缓存维护</span>
          <strong>{{ status.cache.maintenanceCron }}</strong>
        </div>
        <div class="miyako-intel-nav__status">
          <span>资料搜索缓存</span>
          <strong>{{ searchCacheStatus }}</strong>
        </div>
        <button
          type="button"
          class="miyako-intel-nav__action"
          :disabled="isUpdatingStory"
          @click="updateStoryBundle"
          @mousedown.stop
          @touchstart.stop
        >
          {{ isUpdatingStory ? '拉取中...' : '拉取远端全文包' }}
        </button>
        <div v-if="storyUpdateMessage" class="miyako-intel-nav__message">
          {{ storyUpdateMessage }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ComputedRef,
  computed,
  inject,
  onUnmounted,
  reactive,
  ref,
  watch,
} from 'vue'
import { send } from '@koishijs/client'

interface CurrentSettings {
  config?: Record<string, any>
}

interface NavItem {
  id: string
  label: string
  keys: string[]
}

const pluginName = inject<ComputedRef<string>>('plugin:name')
const current = inject<ComputedRef<CurrentSettings>>('manager.settings.current')

const isOwn = computed(() => pluginName?.value === 'koishi-plugin-miyako-intel')
const isCollapsed = ref(false)
const activeItem = ref('')
const isUpdatingStory = ref(false)
const storyUpdateMessage = ref('')

const mouse = reactive({
  moving: false,
  top: 96,
  right: 24,
  startTop: 0,
  startRight: 0,
  startX: 0,
  startY: 0,
  width: 0,
  height: 0,
})

const navItems: NavItem[] = [
  { id: 'site', label: '基础设置', keys: ['baseUrl', 'cacheDirectory', 'refreshCron'] },
  { id: 'capture', label: 'PRTS 今日情报', keys: ['deviceScaleFactor', 'imageFormat', 'jpegQuality'] },
  { id: 'text', label: '消息输出', keys: ['messagePrefix', 'summaryMaxItems', 'summaryDatePreview'] },
  { id: 'theme', label: '外观', keys: ['cardTheme', 'primaryColor', 'textColor'] },
  { id: 'push', label: '定时任务', keys: ['scheduledPush', 'channels'] },
  { id: 'maintenance', label: '缓存维护', keys: ['cacheMaintenance', 'archiveCron'] },
  { id: 'wiki', label: 'Warfarin 资料检索', keys: ['wiki', 'storyBaseUrl', 'searchCacheTtlMs'] },
  { id: 'advanced', label: '调试与高级', keys: ['logLevel', 'userAgent', 'mode'] },
]

const status = ref({
  push: { enabled: false, channels: 0, cron: '' },
  sites: { prts: '未检查', warfarin: '未检查', story: '未检查' },
  cache: { refreshCron: '', pushCron: '', maintenanceCron: '', searchTtlMs: 0, searchEntries: 0, searchMaxEntries: 0, searchLabel: '关闭' },
})
let statusTimer: number | undefined

const positionStyle = computed(() => ({
  top: `${mouse.top}px`,
  right: `${mouse.right}px`,
}))

const pushStatus = computed(() => {
  if (!status.value.push.enabled) return '关闭'
  return `${status.value.push.channels} 个频道`
})

const searchCacheStatus = computed(() => {
  return status.value.cache.searchLabel
})

async function loadStatus() {
  if (!isOwn.value) return
  try {
    status.value = await send('miyako-intel/status') as typeof status.value
  } catch {
    status.value.sites = { prts: '未检查', warfarin: '未检查', story: '未检查' }
  }
}

async function updateStoryBundle() {
  if (isUpdatingStory.value) return
  isUpdatingStory.value = true
  storyUpdateMessage.value = ''
  try {
    const result = await send('miyako-intel/update-story') as { ok?: boolean; message?: string }
    storyUpdateMessage.value = result?.message || (result?.ok ? '已完成。' : '拉取失败。')
    await loadStatus()
  } catch {
    storyUpdateMessage.value = '拉取失败，请查看日志。'
  } finally {
    isUpdatingStory.value = false
  }
}

function toggleCollapse(event: MouseEvent) {
  event.stopPropagation()
  isCollapsed.value = !isCollapsed.value
}

function getText(node: HTMLElement) {
  return `${node.innerHTML}\n${node.textContent || ''}`
}

function findSchemaNode(keys: string[]) {
  const nodes = document.querySelectorAll<HTMLElement>('.k-schema-left')
  for (const node of nodes) {
    const text = getText(node)
    if (keys.some((key) => text.includes(key))) return node
  }
}

function scrollTo(item: NavItem) {
  const node = findSchemaNode(item.keys)
  if (!node) return
  node.scrollIntoView({ block: 'center' })
  activeItem.value = item.id
}

function getPointer(event: MouseEvent | TouchEvent) {
  return event instanceof TouchEvent
    ? event.touches[0] as unknown as MouseEvent
    : event
}

function startMove(event: MouseEvent | TouchEvent) {
  const pointer = getPointer(event)
  const rect = (pointer.target as HTMLElement)
    .closest('[data-miyako-intel-nav="1"]')
    ?.getBoundingClientRect()

  if (rect) {
    mouse.width = rect.width
    mouse.height = rect.height
  }

  mouse.startTop = mouse.top
  mouse.startRight = mouse.right
  mouse.startX = pointer.clientX
  mouse.startY = pointer.clientY
  mouse.moving = true
}

function onMove(event: MouseEvent | TouchEvent) {
  if (!mouse.moving) return
  const pointer = getPointer(event)
  let top = mouse.startTop + pointer.clientY - mouse.startY
  let right = mouse.startRight - (pointer.clientX - mouse.startX)
  const boundary = document.querySelector('.plugin-view')?.getBoundingClientRect()

  let minTop = 0
  let maxTop = window.innerHeight - mouse.height
  let minRight = 0
  let maxRight = window.innerWidth - mouse.width

  if (boundary) {
    minTop = boundary.top
    maxTop = boundary.bottom - mouse.height
    minRight = window.innerWidth - boundary.right
    maxRight = window.innerWidth - boundary.left - mouse.width
  }

  mouse.top = Math.min(Math.max(top, minTop), maxTop)
  mouse.right = Math.min(Math.max(right, minRight), maxRight)
}

function endMove() {
  mouse.moving = false
}

const observed = new Map<Element, string>()
let observer: IntersectionObserver | undefined

function initObserver() {
  observer?.disconnect()
  observed.clear()

  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      const id = observed.get(entry.target)
      if (id) activeItem.value = id
    }
  }, {
    root: null,
    rootMargin: '-40% 0px -40% 0px',
    threshold: 0,
  })

  for (const item of navItems) {
    const node = findSchemaNode(item.keys)
    if (!node) continue
    observer.observe(node)
    observed.set(node, item.id)
  }
}

window.addEventListener('mousemove', onMove)
window.addEventListener('mouseup', endMove)
window.addEventListener('touchmove', onMove)
window.addEventListener('touchend', endMove)

watch(isOwn, (value) => {
  if (!value) return
  setTimeout(initObserver, 800)
  loadStatus()
  if (statusTimer) window.clearInterval(statusTimer)
  statusTimer = window.setInterval(loadStatus, 60000)
}, { immediate: true })

watch(current || ref(), () => {
  if (isOwn.value) setTimeout(initObserver, 800)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', endMove)
  window.removeEventListener('touchmove', onMove)
  window.removeEventListener('touchend', endMove)
  observer?.disconnect()
  if (statusTimer) window.clearInterval(statusTimer)
})
</script>

<style scoped>
.miyako-intel-nav {
  position: absolute;
  z-index: 1000;
  width: 210px;
  max-width: 90vw;
  max-height: 70vh;
  overflow: hidden;
  user-select: none;
  border: 1px solid var(--k-card-border);
  border-radius: 8px;
  background: var(--k-card-bg);
  box-shadow: var(--k-card-shadow);
  color: var(--k-text-normal);
  transition: box-shadow .2s ease, max-height .2s ease;
}

.miyako-intel-nav:hover {
  box-shadow: var(--k-card-shadow-hover, 0 4px 16px rgba(0, 0, 0, .15));
}

.miyako-intel-nav__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-bottom: 1px solid var(--k-color-divider, #ebeef5);
  background: var(--k-hover-bg);
  cursor: move;
}

.miyako-intel-nav__header strong {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
}

.miyako-intel-nav__grip {
  width: 14px;
  height: 14px;
  flex: none;
  opacity: .7;
  background:
    radial-gradient(currentColor 1px, transparent 1.5px) 0 0 / 5px 5px;
}

.miyako-intel-nav__toggle {
  width: 22px;
  height: 22px;
  flex: none;
  border: 0;
  background: transparent;
  color: var(--k-text-light);
  cursor: pointer;
  transition: transform .2s ease, color .2s ease;
}

.miyako-intel-nav__toggle:hover {
  color: var(--k-color-primary);
}

.miyako-intel-nav__body {
  max-height: calc(70vh - 34px);
  overflow-y: auto;
  padding: 4px 0;
  transition: max-height .2s ease, opacity .2s ease;
}

.miyako-intel-nav__section {
  margin-bottom: 4px;
}

.miyako-intel-nav__section-title {
  padding: 6px 12px;
  background: var(--k-bg-light);
  color: var(--k-text-light);
  font-size: 12px;
  font-weight: 600;
}

.miyako-intel-nav__item {
  display: block;
  width: 100%;
  padding: 8px 14px;
  border: 0;
  border-left: 3px solid transparent;
  background: transparent;
  color: var(--k-text-normal);
  cursor: pointer;
  text-align: left;
  font-size: 13px;
}

.miyako-intel-nav__item:hover {
  background: var(--k-hover-bg);
  color: var(--k-text-active);
}

.miyako-intel-nav__item.is-active {
  border-left-color: var(--k-color-primary);
  background: var(--k-activity-bg);
  color: var(--k-color-primary);
  font-weight: 600;
}

.miyako-intel-nav__status {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
}

.miyako-intel-nav__status span {
  color: var(--k-text-light);
}

.miyako-intel-nav__action {
  display: block;
  width: calc(100% - 24px);
  margin: 6px 12px;
  padding: 7px 8px;
  border: 1px solid var(--k-color-primary);
  border-radius: 6px;
  background: transparent;
  color: var(--k-color-primary);
  cursor: pointer;
  font-size: 12px;
}

.miyako-intel-nav__action:disabled {
  cursor: wait;
  opacity: .65;
}

.miyako-intel-nav__message {
  padding: 2px 12px 8px;
  color: var(--k-text-light);
  font-size: 12px;
  line-height: 1.4;
}

.miyako-intel-nav.is-collapsed {
  max-height: 34px;
}

.miyako-intel-nav.is-collapsed .miyako-intel-nav__body {
  max-height: 0;
  opacity: 0;
  overflow: hidden;
}

.miyako-intel-nav.is-collapsed .miyako-intel-nav__toggle {
  transform: rotate(-90deg);
}

@media (max-width: 768px) {
  .miyako-intel-nav {
    width: 170px;
    max-height: 55vh;
  }
}
</style>

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
          <span>推送</span>
          <strong>{{ pushStatus }}</strong>
        </div>
        <div class="miyako-intel-nav__status">
          <span>摘要</span>
          <strong>{{ enabledSummaryCount }}/{{ summaryDisplayItems.length }}</strong>
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
const config = computed(() => current?.value?.config || {})
const isCollapsed = ref(false)
const activeItem = ref('')

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
  { id: 'site', label: '缓存与站点', keys: ['baseUrl', 'cacheDirectory', 'refreshCron'] },
  { id: 'capture', label: '截图', keys: ['deviceScaleFactor', 'imageFormat', 'jpegQuality'] },
  { id: 'text', label: '输出文本', keys: ['messagePrefix', 'summaryMaxItems', 'summaryDatePreview'] },
  { id: 'summary', label: '摘要展示项', keys: ['summaryDisplayItems'] },
  { id: 'theme', label: '视觉主题', keys: ['cardTheme', 'primaryColor', 'textColor'] },
  { id: 'push', label: '定时推送', keys: ['scheduledPush', 'channels'] },
  { id: 'maintenance', label: '缓存维护', keys: ['cacheMaintenance', 'archiveCron'] },
]

const positionStyle = computed(() => ({
  top: `${mouse.top}px`,
  right: `${mouse.right}px`,
}))

const summaryDisplayItems = computed(() => {
  return Array.isArray(config.value.summaryDisplayItems)
    ? config.value.summaryDisplayItems
    : []
})

const enabledSummaryCount = computed(() => {
  return summaryDisplayItems.value.filter((item: any) => item?.enabled !== false).length
})

const pushStatus = computed(() => {
  return config.value.scheduledPush?.enabled ? '开启' : '关闭'
})

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
  if (value) setTimeout(initObserver, 800)
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

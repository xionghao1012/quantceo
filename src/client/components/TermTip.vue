<script setup lang="ts">
import { ref, nextTick, onMounted, onUnmounted } from 'vue'
import { glossary, type GlossaryEntry } from '../utils/glossary'

const props = defineProps<{
  term: string
  label?: string
}>()

const entry = ref<GlossaryEntry | null>(null)
const open = ref(false)
const tipRef = ref<HTMLElement | null>(null)
const popoverRef = ref<HTMLElement | null>(null)
const posStyle = ref({})

function toggle() {
  if (!entry.value) {
    const found = glossary[props.term]
    if (!found) return
    entry.value = found
  }
  open.value = !open.value
  if (open.value) {
    nextTick(() => {
      requestAnimationFrame(updatePosition)
    })
  }
}

function updatePosition() {
  if (!tipRef.value || !popoverRef.value) return
  const trigger = tipRef.value.getBoundingClientRect()
  const popover = popoverRef.value.getBoundingClientRect()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const pw = Math.min(popover.width || 260, vw - 16)
  const ph = popover.height || 120

  // Anchor left edge to trigger, prefer below
  let top: number
  if (trigger.bottom + ph + 8 <= vh) {
    top = trigger.bottom + 8
  } else if (trigger.top - ph - 8 >= 0) {
    top = trigger.top - ph - 8
  } else if (vh - trigger.bottom > trigger.top) {
    top = Math.min(trigger.bottom + 8, vh - ph - 8)
  } else {
    top = Math.max(8, trigger.top - ph - 8)
  }

  // Left-align with trigger, clamp to viewport
  let left = trigger.left
  if (left + pw > vw - 8) left = vw - pw - 8
  left = Math.max(8, left)

  posStyle.value = { top: `${top}px`, left: `${left}px` }
}

let closeTimer: ReturnType<typeof setTimeout> | null = null

function onClickOutside(e: MouseEvent) {
  if (tipRef.value && !tipRef.value.contains(e.target as Node)) {
    open.value = false
  }
}

function onEsc(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

function onScroll() {
  if (open.value) {
    requestAnimationFrame(updatePosition)
  }
}

function onResize() {
  if (open.value) {
    requestAnimationFrame(updatePosition)
  }
}

onMounted(() => {
  document.addEventListener('click', onClickOutside)
  document.addEventListener('keydown', onEsc)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  document.removeEventListener('click', onClickOutside)
  document.removeEventListener('keydown', onEsc)
  window.removeEventListener('scroll', onScroll, true)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <span ref="tipRef" class="term-tip" @click.stop="toggle">
    <span class="tip-icon">?</span>
    <Transition name="fade">
      <div
        v-if="open"
        ref="popoverRef"
        class="tip-popover"
        :style="posStyle"
      >
        <div class="tip-title">{{ entry?.label || term }}</div>
        <div class="tip-body">{{ entry?.explanation }}</div>
      </div>
    </Transition>
  </span>
</template>

<style scoped>
.term-tip {
  position: relative;
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  vertical-align: middle;
  user-select: none;
}
.tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--text-tertiary, #555);
  color: var(--bg, #0d0d0d);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  transition: background 0.15s;
  margin-left: 3px;
}
.tip-icon:hover { background: var(--brand, #f59e0b); }

.tip-popover {
  position: fixed;
  width: 260px;
  max-width: calc(100vw - 16px);
  background: #1a1a1a;
  border: 1px solid var(--border, #444);
  border-radius: 8px;
  padding: 10px 12px;
  z-index: 99999;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
}
.tip-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--brand, #f59e0b);
  margin-bottom: 6px;
}
.tip-body {
  font-size: 12px;
  color: var(--text-secondary, #aaa);
  line-height: 1.6;
}
.fade-enter-active,
.fade-leave-active { transition: opacity 0.15s; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
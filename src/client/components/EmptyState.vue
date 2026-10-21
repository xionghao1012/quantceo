<script setup lang="ts">
/**
 * 统一的空状态：全站用同一个 SVG 插图 + 文案 + 可选操作。
 * 之前各页面各写各的 emoji（🤖 📊 🔔 📡 📋 📅 📭），风格不统一还依赖
 * emoji 字体渲染，这里收敛成一套。
 */
defineProps<{
  /** 插图变体：默认是「空列表」 */
  variant?: 'list' | 'search' | 'alert'
  text?: string
}>()
</script>

<template>
  <div class="empty-state">
    <svg
      class="empty-art"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      stroke-width="2.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <template v-if="variant === 'search'">
        <circle cx="27" cy="27" r="15" />
        <path d="M38 38 L52 52" />
        <path d="M21 27h12" />
      </template>
      <template v-else-if="variant === 'alert'">
        <path d="M32 10 L54 50 H10 Z" />
        <path d="M32 24v12" />
        <circle cx="32" cy="42" r="1.6" fill="currentColor" stroke="none" />
      </template>
      <template v-else>
        <path d="M10 20h44l-4 30H14z" />
        <path d="M10 20 L14 10h36l4 10" />
        <path d="M26 30h12" />
      </template>
    </svg>
    <p v-if="text" class="empty-text">{{ text }}</p>
    <slot />
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-tertiary);
}

.empty-art {
  width: 48px;
  height: 48px;
  color: var(--text-tertiary);
  opacity: 0.55;
}

.empty-text {
  margin: 0;
  font-size: 13px;
}
</style>

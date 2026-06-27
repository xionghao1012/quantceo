import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { WatchlistItem, WatchlistGroup } from '@shared/types'
import { useAuthStore } from './auth'

export const useWatchlistStore = defineStore('watchlist', () => {
  const items = ref<WatchlistItem[]>([])
  const groups = ref<WatchlistGroup[]>([])
  const loading = ref(false)

  async function fetchAll() {
    const auth = useAuthStore()
    if (!auth.isLoggedIn) return
    loading.value = true
    try {
      const [itemsRes, groupsRes] = await Promise.all([
        fetch('/api/watchlist', { headers: auth.authHeaders() }),
        fetch('/api/watchlist/groups', { headers: auth.authHeaders() }),
      ])
      if (itemsRes.ok) items.value = await itemsRes.json()
      if (groupsRes.ok) groups.value = await groupsRes.json()
    } catch {}
    loading.value = false
  }

  async function add(code: string, note?: string, groupId?: number) {
    const auth = useAuthStore()
    const res = await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({ code, note, groupId }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '添加失败')
    }
    const item = await res.json()
    items.value.push(item)
  }

  async function remove(id: number) {
    const auth = useAuthStore()
    const res = await fetch(`/api/watchlist/${id}`, {
      method: 'DELETE',
      headers: auth.authHeaders(),
    })
    if (res.ok) {
      items.value = items.value.filter(i => i.id !== id)
    }
  }

  async function updateItem(id: number, data: { note?: string; groupId?: number | null }) {
    const auth = useAuthStore()
    const res = await fetch(`/api/watchlist/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '更新失败')
    }
    const updated = await res.json()
    const idx = items.value.findIndex(i => i.id === id)
    if (idx !== -1) items.value[idx] = updated
    return updated
  }

  async function createGroup(name: string, color?: string) {
    const auth = useAuthStore()
    const res = await fetch('/api/watchlist/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify({ name, color }),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '创建分组失败')
    }
    const group = await res.json()
    groups.value.push(group)
    return group
  }

  async function updateGroup(id: number, data: { name?: string; color?: string; sortOrder?: number }) {
    const auth = useAuthStore()
    const res = await fetch(`/api/watchlist/groups/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth.authHeaders() },
      body: JSON.stringify(data),
    })
    if (!res.ok) {
      const err = await res.json()
      throw new Error(err.error || '更新分组失败')
    }
    const updated = await res.json()
    const idx = groups.value.findIndex(g => g.id === id)
    if (idx !== -1) groups.value[idx] = updated
    return updated
  }

  async function deleteGroup(id: number) {
    const auth = useAuthStore()
    const res = await fetch(`/api/watchlist/groups/${id}`, {
      method: 'DELETE',
      headers: auth.authHeaders(),
    })
    if (res.ok) {
      groups.value = groups.value.filter(g => g.id !== id)
      items.value.forEach(i => {
        if (i.groupId === id) i.groupId = null
      })
    }
  }

  function isInWatchlist(code: string): boolean {
    return items.value.some(i => i.code === code)
  }

  return {
    items, groups, loading, fetchAll,
    add, remove, updateItem,
    createGroup, updateGroup, deleteGroup,
    isInWatchlist,
  }
})

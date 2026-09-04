<script setup>
import { ref, computed } from 'vue'
import { hexToNpub, resolveToHex } from '../nostr.js'

const props = defineProps({
  nodes: { type: Array, default: () => [] }
})
const emit = defineEmits(['locate'])

const query = ref('')
const open = ref(false)

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return []

  const directHex = resolveToHex(query.value)
  const matches = props.nodes.filter((n) => {
    if (directHex && n.id === directHex) return true
    if (n.id.toLowerCase().startsWith(q)) return true
    if (n.name && n.name.toLowerCase().includes(q)) return true
    if (n.nip05 && n.nip05.toLowerCase().includes(q)) return true
    return false
  })
  return matches.slice(0, 8)
})

function pick(node) {
  emit('locate', node)
  query.value = ''
  open.value = false
}
</script>

<template>
  <div class="search">
    <input
      v-model="query"
      class="search__input"
      type="text"
      placeholder="Search Nostr users…"
      @focus="open = true"
      @blur="() => setTimeout(() => (open = false), 150)"
    />
    <div v-if="open && query && results.length" class="search__results scroll-thin">
      <button v-for="node in results" :key="node.id" class="search__result" @click="pick(node)">
        <span class="search__result-name">{{ node.name || node.id.slice(0, 10) + '…' }}</span>
        <span class="search__result-npub">{{ (hexToNpub(node.id) || node.id).slice(0, 18) }}…</span>
        <span v-if="node.nip05Verified" class="search__result-verified">✓ NIP-05</span>
      </button>
    </div>
    <div v-else-if="open && query && !results.length" class="search__empty">No matching stars found</div>
  </div>
</template>

<style scoped>
.search {
  position: relative;
  width: min(260px, 60vw);
}

.search__input {
  width: 100%;
  background: var(--bg-panel);
  backdrop-filter: blur(10px);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 10px 12px;
  color: var(--star-white);
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
}
.search__input:focus {
  border-color: var(--c-purple);
}
.search__input::placeholder {
  color: var(--dim);
}

.search__results {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  max-height: 260px;
  overflow-y: auto;
  background: var(--bg-panel-solid);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 4px;
}

.search__result {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  width: 100%;
  background: none;
  border: none;
  border-radius: 7px;
  padding: 8px 9px;
  text-align: left;
  color: var(--star-white);
}
.search__result:hover {
  background: rgba(255, 255, 255, 0.06);
}
.search__result-name {
  font-size: 13px;
}
.search__result-npub {
  font-size: 11px;
  color: var(--dim);
}
.search__result-verified {
  font-size: 10.5px;
  color: var(--c-gold);
}

.search__empty {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--bg-panel-solid);
  border: 1px solid var(--hairline);
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 12px;
  color: var(--dim);
}
</style>

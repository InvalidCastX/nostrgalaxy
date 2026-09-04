<script setup>
import { ref, reactive, computed, onBeforeUnmount } from 'vue'
import GalaxyView from './components/GalaxyView.vue'
import ProfilePopup from './components/ProfilePopup.vue'
import SearchBox from './components/SearchBox.vue'
import { RelayPool, DEFAULT_RELAYS, resolveToHex, hexToNpub } from './nostr.js'
import { buildGalaxy, layoutGalaxy, detectConstellations } from './galaxy.js'

// --- configurable MVP limits (spec: "Do NOT load the entire Nostr network") ---
const MAX_PROFILES = 500
const MAX_EVENTS = 5000

const screen = ref('landing') // 'landing' | 'galaxy'
const connection = reactive({ state: 'idle', lastUpdate: null, error: null }) // idle | connecting | connected | failed

const rawProfiles = new Map() // pubkey -> kind0 event
const rawNotes = []
const rawReposts = []
const rawReactions = []
let eventCount = 0

const nodes = ref([])
const edges = ref([])
const constellations = ref([])

const selectedNode = ref(null)
const focusToken = reactive({ id: null, nonce: 0 })
const orbitPubkey = ref(null)
const orbitInput = ref('')
const orbitError = ref('')
const showConstellations = ref(false)

let pool = null
let rebuildTimer = null

function scheduleRebuild() {
  if (rebuildTimer) return
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null
    rebuild()
  }, 900)
}

function rebuild() {
  const { nodes: n, edges: e } = buildGalaxy({
    profiles: rawProfiles,
    notes: rawNotes,
    reposts: rawReposts,
    reactions: rawReactions
  })
  const laidOut = layoutGalaxy(n, e, { width: 2200, height: 1600 })
  nodes.value = laidOut
  edges.value = e
  constellations.value = detectConstellations(laidOut, e)
  connection.lastUpdate = Date.now()
  // keep selection pointing at the freshest copy of the same node
  if (selectedNode.value) {
    const fresh = laidOut.find((x) => x.id === selectedNode.value.id)
    if (fresh) selectedNode.value = fresh
  }
}

function enterGalaxy() {
  screen.value = 'galaxy'
  if (connection.state === 'idle') connectToRelays()
}

function connectToRelays() {
  connection.state = 'connecting'
  connection.error = null
  pool = new RelayPool(DEFAULT_RELAYS)
  pool.onStatusChange = (summary) => {
    const values = Object.values(summary)
    if (values.some((s) => s === 'open')) connection.state = 'connected'
    else if (values.every((s) => s === 'closed' || s === 'error')) {
      connection.state = 'failed'
      connection.error = 'Unable to reach relays'
    }
  }
  pool.connect()

  pool.subscribe([{ kinds: [0], limit: MAX_PROFILES }], {
    onEvent: (event) => {
      if (eventCount > MAX_EVENTS) return
      const existing = rawProfiles.get(event.pubkey)
      if (!existing || existing.created_at < event.created_at) {
        rawProfiles.set(event.pubkey, event)
        eventCount++
        scheduleRebuild()
      }
    }
  })

  pool.subscribe([{ kinds: [1], limit: 2000 }], {
    onEvent: (event) => {
      if (eventCount > MAX_EVENTS) return
      rawNotes.push(event)
      eventCount++
      scheduleRebuild()
    }
  })

  pool.subscribe([{ kinds: [6], limit: 500 }], {
    onEvent: (event) => {
      if (eventCount > MAX_EVENTS) return
      rawReposts.push(event)
      eventCount++
      scheduleRebuild()
    }
  })

  pool.subscribe([{ kinds: [7], limit: 1000 }], {
    onEvent: (event) => {
      if (eventCount > MAX_EVENTS) return
      rawReactions.push(event)
      eventCount++
      scheduleRebuild()
    }
  })
}

onBeforeUnmount(() => {
  pool?.closeAll()
  if (rebuildTimer) clearTimeout(rebuildTimer)
})

const lastUpdateLabel = computed(() => {
  if (!connection.lastUpdate) return null
  const secs = Math.max(0, Math.round((Date.now() - connection.lastUpdate) / 1000))
  if (secs < 5) return 'just now'
  if (secs < 60) return `${secs} seconds ago`
  return `${Math.round(secs / 60)} min ago`
})

function selectStar(node) {
  selectedNode.value = node
}
function closePopup() {
  selectedNode.value = null
}
function focusOn(id) {
  focusToken.id = id
  focusToken.nonce++
}

function locateNode(node) {
  selectedNode.value = node
  focusOn(node.id)
}

// --- orbit mode ---
const orbitData = computed(() => {
  if (!orbitPubkey.value) return null
  const center = nodes.value.find((n) => n.id === orbitPubkey.value)
  if (!center) return null

  const adjacency = new Map()
  for (const n of nodes.value) adjacency.set(n.id, new Set())
  for (const e of edges.value) {
    const s = e.source?.id || e.source
    const t = e.target?.id || e.target
    if (adjacency.has(s) && adjacency.has(t)) {
      adjacency.get(s).add(t)
      adjacency.get(t).add(s)
    }
  }

  const distance = new Map([[center.id, 0]])
  let frontier = [center.id]
  for (let d = 1; d <= 3; d++) {
    const next = []
    for (const id of frontier) {
      for (const neighbor of adjacency.get(id) || []) {
        if (!distance.has(neighbor)) {
          distance.set(neighbor, d)
          next.push(neighbor)
        }
      }
    }
    frontier = next
  }

  const byId = new Map(nodes.value.map((n) => [n.id, n]))
  const byDistance = { 1: [], 2: [], 3: [] }
  for (const [id, d] of distance) {
    if (d >= 1 && d <= 3 && byId.has(id)) byDistance[d].push(byId.get(id))
  }
  return { center, byDistance, visibleIds: new Set(distance.keys()) }
})

const orbitFilteredNodes = computed(() => {
  if (!orbitData.value) return nodes.value
  return nodes.value.filter((n) => orbitData.value.visibleIds.has(n.id))
})
const orbitFilteredEdges = computed(() => {
  if (!orbitData.value) return edges.value
  return edges.value.filter((e) => {
    const s = e.source?.id || e.source
    const t = e.target?.id || e.target
    return orbitData.value.visibleIds.has(s) && orbitData.value.visibleIds.has(t)
  })
})

function enterOrbit() {
  orbitError.value = ''
  const hex = resolveToHex(orbitInput.value)
  if (!hex) {
    orbitError.value = 'Enter a valid npub, nprofile, or hex pubkey'
    return
  }
  if (!nodes.value.find((n) => n.id === hex)) {
    orbitError.value = 'That identity has no observed activity in the current window'
    return
  }
  orbitPubkey.value = hex
  focusOn(hex)
}
function exitOrbit() {
  orbitPubkey.value = null
  orbitInput.value = ''
  orbitError.value = ''
}

function displayNodes() {
  return orbitPubkey.value ? orbitFilteredNodes.value : nodes.value
}
function displayEdges() {
  return orbitPubkey.value ? orbitFilteredEdges.value : edges.value
}
</script>

<template>
  <!-- LANDING -->
  <div v-if="screen === 'landing'" class="landing">
    <div class="landing__stars" aria-hidden="true"></div>
    <div class="landing__content">
      <p class="landing__eyebrow">A telescope for the Nostr social universe</p>
      <h1 class="landing__title">Nostr Galaxy</h1>
      <p class="landing__body">
        Explore the people, communities, and conversations forming the Nostr universe — rendered as stars,
        gravitational links, and constellations.
      </p>
      <button class="landing__cta" @click="enterGalaxy">Enter Galaxy</button>
      <ul class="landing__notes">
        <li>No account required</li>
        <li>No private keys, ever</li>
        <li>Uses public Nostr relay data only</li>
      </ul>
    </div>
  </div>

  <!-- GALAXY -->
  <div v-else class="app">
    <header class="topbar">
      <div class="topbar__brand">
        <span class="topbar__title">Nostr Galaxy</span>
        <span class="topbar__status" :class="`status--${connection.state}`">
          <span class="dot"></span>
          <template v-if="connection.state === 'connected'">Connected</template>
          <template v-else-if="connection.state === 'connecting'">Connecting to Nostr universe…</template>
          <template v-else-if="connection.state === 'failed'">Unable to reach relays</template>
          <template v-else>Idle</template>
        </span>
      </div>
      <SearchBox :nodes="nodes" @locate="locateNode" />
    </header>

    <GalaxyView
      :nodes="displayNodes()"
      :edges="displayEdges()"
      :selected-id="selectedNode?.id || null"
      :focus-token="focusToken"
      @select-star="selectStar"
      @background-click="closePopup"
    />

    <!-- orbit mode panel -->
    <div class="orbit-panel">
      <template v-if="!orbitPubkey">
        <label class="orbit-panel__label">Your Orbit</label>
        <div class="orbit-panel__row">
          <input v-model="orbitInput" placeholder="npub1…" class="orbit-panel__input" @keyup.enter="enterOrbit" />
          <button class="orbit-panel__go" @click="enterOrbit">Go</button>
        </div>
        <p v-if="orbitError" class="orbit-panel__error">{{ orbitError }}</p>
      </template>
      <template v-else>
        <div class="orbit-panel__active">
          <div>
            <p class="orbit-panel__label">Your Orbit</p>
            <p class="orbit-panel__center">{{ orbitData?.center?.name || hexToNpub(orbitPubkey)?.slice(0, 14) }}</p>
          </div>
          <button class="orbit-panel__exit" @click="exitOrbit">Exit</button>
        </div>
        <dl class="orbit-panel__distances">
          <dt>Distance 1</dt>
          <dd>{{ orbitData?.byDistance[1]?.length || 0 }} direct interactions</dd>
          <dt>Distance 2</dt>
          <dd>{{ orbitData?.byDistance[2]?.length || 0 }} connected through others</dd>
          <dt>Distance 3</dt>
          <dd>{{ orbitData?.byDistance[3]?.length || 0 }} wider community</dd>
        </dl>
      </template>
    </div>

    <!-- status / constellations footer -->
    <div class="footer-row">
      <div class="status-chip">
        <span class="dot" :class="`dot--${connection.state}`"></span>
        <span v-if="connection.state === 'connected'">
          {{ nodes.length }} stars observed<template v-if="lastUpdateLabel"> · updated {{ lastUpdateLabel }}</template>
        </span>
        <span v-else-if="connection.state === 'connecting'">Connecting to Nostr universe…</span>
        <span v-else-if="connection.state === 'failed'">Unable to reach relays</span>
      </div>
      <button v-if="constellations.length" class="constellation-toggle" @click="showConstellations = !showConstellations">
        {{ constellations.length }} possible cluster{{ constellations.length === 1 ? '' : 's' }}
      </button>
    </div>

    <div v-if="showConstellations" class="constellation-panel scroll-thin">
      <button class="constellation-panel__close" @click="showConstellations = false" aria-label="Close">✕</button>
      <h4>Constellations</h4>
      <ul>
        <li v-for="(c, i) in constellations" :key="i">
          <button
            class="constellation-item"
            @click="
              () => {
                focusOn(c.members[0].id)
                showConstellations = false
              }
            "
          >
            <span class="constellation-item__label">{{ c.label }}</span>
            <span class="constellation-item__size">{{ c.size }} members</span>
          </button>
        </li>
      </ul>
    </div>

    <!-- selected star popup -->
    <div v-if="selectedNode" class="popup-anchor">
      <ProfilePopup :node="selectedNode" @close="closePopup" />
    </div>
  </div>
</template>

<style scoped>
/* ---------- landing ---------- */
.landing {
  position: relative;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 24px;
}
.landing__stars {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(1.5px 1.5px at 20% 30%, rgba(255, 255, 255, 0.5) 50%, transparent),
    radial-gradient(1.5px 1.5px at 70% 60%, rgba(255, 255, 255, 0.4) 50%, transparent),
    radial-gradient(1px 1px at 40% 80%, rgba(255, 255, 255, 0.35) 50%, transparent),
    radial-gradient(1.5px 1.5px at 85% 20%, rgba(255, 255, 255, 0.45) 50%, transparent),
    radial-gradient(1px 1px at 60% 15%, rgba(255, 255, 255, 0.3) 50%, transparent),
    radial-gradient(ellipse at 50% 30%, rgba(120, 100, 200, 0.16), transparent 60%);
  background-size: cover;
}
.landing__content {
  position: relative;
  max-width: 480px;
  text-align: center;
}
.landing__eyebrow {
  color: var(--c-purple);
  font-size: 13px;
  margin: 0 0 10px;
}
.landing__title {
  font-family: var(--font-display);
  font-size: clamp(40px, 9vw, 64px);
  font-weight: 500;
  margin: 0 0 16px;
  letter-spacing: -0.01em;
}
.landing__body {
  color: var(--dim);
  line-height: 1.6;
  font-size: 15px;
  margin: 0 0 30px;
}
.landing__cta {
  background: var(--star-white);
  color: var(--bg-void);
  border: none;
  border-radius: 999px;
  padding: 14px 30px;
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 26px;
}
.landing__notes {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--dim);
  font-size: 12.5px;
}

/* ---------- galaxy screen ---------- */
.app {
  position: relative;
  height: 100%;
  overflow: hidden;
}

.topbar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  background: linear-gradient(to bottom, rgba(5, 6, 12, 0.85), transparent);
}
.topbar__brand {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
.topbar__title {
  font-family: var(--font-display);
  font-size: 17px;
  white-space: nowrap;
}
.topbar__status {
  display: none;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--dim);
}
@media (min-width: 640px) {
  .topbar__status {
    display: flex;
  }
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--dim);
}
.status--connected .dot,
.dot--connected {
  background: var(--c-green);
  box-shadow: 0 0 6px var(--c-green);
}
.status--connecting .dot,
.dot--connecting {
  background: var(--c-blue);
}
.status--failed .dot,
.dot--failed {
  background: var(--c-red);
}

.orbit-panel {
  position: absolute;
  left: 16px;
  bottom: 16px;
  z-index: 5;
  width: min(240px, 46vw);
  background: var(--bg-panel);
  backdrop-filter: blur(10px);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  padding: 12px;
  font-size: 12.5px;
}
.orbit-panel__label {
  margin: 0 0 6px;
  color: var(--dim);
  font-size: 11.5px;
}
.orbit-panel__row {
  display: flex;
  gap: 6px;
}
.orbit-panel__input {
  flex: 1;
  min-width: 0;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--hairline);
  border-radius: 7px;
  padding: 7px 8px;
  color: var(--star-white);
  font-size: 12px;
  font-family: var(--font-ui);
}
.orbit-panel__go {
  background: var(--c-purple);
  color: #0d0820;
  border: none;
  border-radius: 7px;
  padding: 0 12px;
  font-weight: 600;
  font-size: 12px;
}
.orbit-panel__error {
  margin: 6px 0 0;
  color: var(--c-red);
  font-size: 11px;
}
.orbit-panel__active {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
}
.orbit-panel__center {
  margin: 0;
  font-size: 13px;
}
.orbit-panel__exit {
  background: none;
  border: 1px solid var(--hairline);
  color: var(--dim);
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 11px;
}
.orbit-panel__distances {
  margin: 10px 0 0;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 3px 8px;
}
.orbit-panel__distances dt {
  color: var(--dim);
}
.orbit-panel__distances dd {
  margin: 0;
}

.footer-row {
  position: absolute;
  right: 16px;
  bottom: 16px;
  z-index: 5;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}
.status-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--bg-panel);
  backdrop-filter: blur(10px);
  border: 1px solid var(--hairline);
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 11.5px;
  color: var(--dim);
}
.constellation-toggle {
  background: var(--bg-panel);
  border: 1px solid var(--hairline);
  color: var(--star-white);
  border-radius: 999px;
  padding: 7px 12px;
  font-size: 11.5px;
}

.constellation-panel {
  position: absolute;
  right: 16px;
  bottom: 64px;
  z-index: 6;
  width: min(260px, 60vw);
  max-height: 300px;
  overflow-y: auto;
  background: var(--bg-panel-solid);
  border: 1px solid var(--hairline);
  border-radius: 12px;
  padding: 14px;
}
.constellation-panel h4 {
  margin: 0 0 8px;
  font-size: 13px;
}
.constellation-panel__close {
  position: absolute;
  top: 8px;
  right: 8px;
  background: none;
  border: none;
  color: var(--dim);
}
.constellation-panel ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.constellation-item {
  width: 100%;
  text-align: left;
  background: rgba(255, 255, 255, 0.04);
  border: none;
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.constellation-item__label {
  font-size: 12px;
  color: var(--c-green);
}
.constellation-item__size {
  font-size: 10.5px;
  color: var(--dim);
}

.popup-anchor {
  position: absolute;
  left: 50%;
  bottom: 16px;
  transform: translateX(-50%);
  z-index: 10;
}
@media (min-width: 640px) {
  .popup-anchor {
    left: auto;
    right: 16px;
    top: 70px;
    bottom: auto;
    transform: none;
  }
}
</style>

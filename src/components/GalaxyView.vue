<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import StarNode from './StarNode.vue'

const props = defineProps({
  nodes: { type: Array, default: () => [] },
  edges: { type: Array, default: () => [] },
  selectedId: { type: String, default: null },
  focusToken: { type: Object, default: () => ({ id: null, nonce: 0 }) } // { id, nonce } — camera pans/zooms to id whenever nonce changes
})
const emit = defineEmits(['select-star', 'background-click'])

const viewportEl = ref(null)
const view = reactive({ x: 0, y: 0, scale: 0.55, rotation: 0 })
const viewportSize = reactive({ width: 0, height: 0 })
const dragging = ref(false)
let dragStart = null
let pinchStart = null

const nodeById = computed(() => new Map(props.nodes.map((n) => [n.id, n])))

// --- viewport culling ---
// Rendering every star as DOM (avatar + glow + label) is what actually
// hangs the tab once a few hundred accounts are loaded — not the data
// fetch itself. So only mount stars that are within (or just outside)
// the visible viewport; panning/zooming re-derives this cheaply.
const CULL_MARGIN = 240 // screen px of slack around the viewport edge
const MAX_RENDERED_STARS = 260 // hard ceiling even if zoomed far out

// Sticky set from the previous computation — lets the margin trim below
// prefer stars it already rendered, instead of re-litigating the ranking
// from scratch every time a star drifts a pixel across a boundary.
const previouslyRendered = new Set()

const culledNodes = computed(() => {
  const w = viewportSize.width || 1
  const h = viewportSize.height || 1
  const rad = (view.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)

  // Split into "actually on screen" vs "just in the off-screen slack".
  // This distinction matters: the activity cap below must never evict a
  // star that's plainly visible just because something else scrolled
  // into the margin and outranked it — that's what caused stars to blink
  // out and back in while panning, with no relation to their own motion.
  const strictlyVisible = []
  const marginOnly = []
  for (const n of props.nodes) {
    const lx = n.x * view.scale
    const ly = n.y * view.scale
    const sx = view.x + (lx * cos - ly * sin)
    const sy = view.y + (lx * sin + ly * cos)
    if (sx >= 0 && sx <= w && sy >= 0 && sy <= h) {
      strictlyVisible.push(n)
    } else if (sx >= -CULL_MARGIN && sx <= w + CULL_MARGIN && sy >= -CULL_MARGIN && sy <= h + CULL_MARGIN) {
      marginOnly.push(n)
    }
  }

  // Always keep the selected/focused star mounted even if it drifted
  // off-screen, so the popup and camera focus never lose their target.
  // These are appended after the cap below, so they can never be sorted
  // out the way they previously could be.
  const mustKeepIds = [props.selectedId, props.focusToken?.id].filter(Boolean)
  const shownIds = new Set([...strictlyVisible, ...marginOnly].map((n) => n.id))
  const mustKeepNodes = []
  for (const id of mustKeepIds) {
    if (!shownIds.has(id)) {
      const n = nodeById.value.get(id)
      if (n) mustKeepNodes.push(n)
    }
  }

  // The activity cap only ever trims the off-screen margin buffer, never
  // what's strictly visible — so a comfortably on-screen star can no
  // longer vanish because of arrivals elsewhere.
  const budget = Math.max(0, MAX_RENDERED_STARS - strictlyVisible.length - mustKeepNodes.length)
  let marginKept = marginOnly
  if (marginOnly.length > budget) {
    marginKept = [...marginOnly]
      .sort((a, b) => {
        // Prefer whatever was already rendered a moment ago, so a star
        // sitting right at the margin boundary doesn't rapidly toggle
        // in and out as the viewport shifts by a pixel at a time.
        const aSticky = previouslyRendered.has(a.id) ? 1 : 0
        const bSticky = previouslyRendered.has(b.id) ? 1 : 0
        if (aSticky !== bSticky) return bSticky - aSticky
        return (b.activity || 0) - (a.activity || 0)
      })
      .slice(0, budget)
  }

  const result = [...strictlyVisible, ...marginKept, ...mustKeepNodes]
  previouslyRendered.clear()
  for (const n of result) previouslyRendered.add(n.id)
  return result
})

const culledIds = computed(() => new Set(culledNodes.value.map((n) => n.id)))

const visibleEdges = computed(() =>
  props.edges.filter((e) => {
    const s = e.source?.id || e.source
    const t = e.target?.id || e.target
    return culledIds.value.has(s) && culledIds.value.has(t)
  })
)

function updateViewportSize() {
  if (!viewportEl.value) return
  const rect = viewportEl.value.getBoundingClientRect()
  viewportSize.width = rect.width
  viewportSize.height = rect.height
}

function nodeXY(idOrNode) {
  const n = typeof idOrNode === 'object' ? idOrNode : nodeById.value.get(idOrNode)
  return n ? { x: n.x, y: n.y } : { x: 0, y: 0 }
}

function edgeStyle(edge) {
  const w = edge.strength === 'strong' ? 2 : edge.strength === 'medium' ? 1.2 : 0.6
  const o = edge.strength === 'strong' ? 0.55 : edge.strength === 'medium' ? 0.32 : 0.16
  return { width: w, opacity: o }
}

function radiusFor(node) {
  // Slightly larger than the old sizing — bigger comfortable tap targets
  // on mobile, and matched to the wider collision spacing in galaxy.js
  // so visual size and actual spacing stay consistent.
  return 13 + Math.sqrt(1 + (node.activity || 0)) * 3.8
}

// --- pan / zoom (mouse + touch) ---
function onPointerDown(e) {
  if (e.target.closest('.star')) return
  dragging.value = true
  dragStart = { x: e.clientX - view.x, y: e.clientY - view.y }
}
function onPointerMove(e) {
  if (!dragging.value || !dragStart) return
  view.x = e.clientX - dragStart.x
  view.y = e.clientY - dragStart.y
}
function onPointerUp() {
  dragging.value = false
  dragStart = null
}
function onWheel(e) {
  e.preventDefault()
  if (e.shiftKey) {
    // Desktop rotate: shift+scroll turns the map (touch users get the
    // two-finger twist gesture instead — see onTouchMove).
    view.rotation += e.deltaY * 0.15
    return
  }
  const delta = -e.deltaY * 0.0012
  zoomAt(e.clientX, e.clientY, delta)
}
function zoomAt(clientX, clientY, delta) {
  const rect = viewportEl.value.getBoundingClientRect()
  const cx = clientX - rect.left
  const cy = clientY - rect.top
  const newScale = Math.min(3, Math.max(0.12, view.scale * (1 + delta)))
  const ratio = newScale / view.scale
  view.x = cx - (cx - view.x) * ratio
  view.y = cy - (cy - view.y) * ratio
  view.scale = newScale
}

function dist(t0, t1) {
  return Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY)
}
function angleOf(t0, t1) {
  return Math.atan2(t1.clientY - t0.clientY, t1.clientX - t0.clientX)
}
function onTouchStart(e) {
  if (e.touches.length === 1) {
    if (e.target.closest('.star')) return
    dragging.value = true
    dragStart = { x: e.touches[0].clientX - view.x, y: e.touches[0].clientY - view.y }
  } else if (e.touches.length === 2) {
    dragging.value = false
    pinchStart = {
      d: dist(e.touches[0], e.touches[1]),
      scale: view.scale,
      angle: angleOf(e.touches[0], e.touches[1]),
      rotation: view.rotation
    }
  }
}
function onTouchMove(e) {
  if (e.touches.length === 1 && dragging.value && dragStart) {
    view.x = e.touches[0].clientX - dragStart.x
    view.y = e.touches[0].clientY - dragStart.y
  } else if (e.touches.length === 2 && pinchStart) {
    e.preventDefault()
    const d = dist(e.touches[0], e.touches[1])
    const factor = d / pinchStart.d
    const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2
    const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2
    const rect = viewportEl.value.getBoundingClientRect()
    const cx = midX - rect.left
    const cy = midY - rect.top
    const newScale = Math.min(3, Math.max(0.12, pinchStart.scale * factor))
    const ratio = newScale / view.scale
    view.x = cx - (cx - view.x) * ratio
    view.y = cy - (cy - view.y) * ratio
    view.scale = newScale

    // Twist to rotate — a second finger turning around the first is the
    // standard mobile "rotate the map" gesture (same as Google/Apple Maps).
    const angle = angleOf(e.touches[0], e.touches[1])
    const deltaDeg = ((angle - pinchStart.angle) * 180) / Math.PI
    view.rotation = pinchStart.rotation + deltaDeg
  }
}
function onTouchEnd(e) {
  if (e.touches.length === 0) {
    dragging.value = false
    dragStart = null
    pinchStart = null
  }
}

function centerOn(node, scale = 1.4) {
  if (!node || !viewportEl.value) return
  view.scale = scale
  view.x = viewportSize.width / 2 - node.x * scale
  view.y = viewportSize.height / 2 - node.y * scale
}

watch(
  () => props.focusToken?.nonce,
  () => {
    const n = props.focusToken?.id && nodeById.value.get(props.focusToken.id)
    if (n) centerOn(n)
  }
)

onMounted(() => {
  if (viewportEl.value) {
    updateViewportSize()
    view.x = viewportSize.width / 2
    view.y = viewportSize.height / 2
  }
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('resize', updateViewportSize)
})
onBeforeUnmount(() => {
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('resize', updateViewportSize)
})
</script>

<template>
  <div
    ref="viewportEl"
    class="galaxy-viewport"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @wheel="onWheel"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
    @click="$emit('background-click')"
  >
    <div class="galaxy-field" :style="{ transform: `translate(${view.x}px, ${view.y}px) rotate(${view.rotation}deg) scale(${view.scale})` }">
      <svg class="galaxy-links" overflow="visible">
        <line
          v-for="(e, i) in visibleEdges"
          :key="i"
          :x1="nodeXY(e.source).x"
          :y1="nodeXY(e.source).y"
          :x2="nodeXY(e.target).x"
          :y2="nodeXY(e.target).y"
          class="galaxy-link"
          :style="{ '--w': edgeStyle(e).width, '--o': edgeStyle(e).opacity }"
        />
      </svg>
      <StarNode
        v-for="node in culledNodes"
        :key="node.id"
        :node="node"
        :radius="radiusFor(node)"
        :selected="node.id === selectedId"
        :rotation="view.rotation"
        @select="(n) => emit('select-star', n)"
      />
    </div>

    <button
      class="compass"
      :class="{ 'compass--active': Math.abs(view.rotation % 360) > 1 }"
      @click.stop="view.rotation = 0"
      aria-label="Reset rotation to north"
      title="Reset rotation"
    >
      <span class="compass__needle" :style="{ transform: `rotate(${-view.rotation}deg)` }">▲</span>
    </button>
  </div>
</template>

<style scoped>
.galaxy-viewport {
  position: absolute;
  inset: 0;
  overflow: hidden;
  touch-action: none;
  cursor: grab;
  background: radial-gradient(ellipse at 50% 40%, rgba(80, 70, 140, 0.12), transparent 60%), var(--bg-void);
}
.galaxy-viewport:active {
  cursor: grabbing;
}

.galaxy-field {
  position: absolute;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  transform-origin: 0 0;
  will-change: transform;
}

.galaxy-links {
  position: absolute;
  left: 0;
  top: 0;
  width: 1px;
  height: 1px;
  overflow: visible;
  pointer-events: none;
}

.galaxy-link {
  stroke: var(--star-white);
  stroke-width: var(--w);
  opacity: var(--o);
}

.compass {
  position: absolute;
  right: 14px;
  top: 50%;
  transform: translateY(-50%);
  z-index: 4;
  width: 42px;
  height: 42px;
  border-radius: 50%;
  background: var(--bg-panel);
  backdrop-filter: blur(10px);
  border: 1px solid var(--hairline);
  color: var(--dim);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
}
.compass--active {
  color: var(--c-purple);
  border-color: var(--c-purple);
}
.compass__needle {
  display: inline-block;
  line-height: 1;
}
</style>

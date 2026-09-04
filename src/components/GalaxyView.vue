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
const view = reactive({ x: 0, y: 0, scale: 0.55 })
const dragging = ref(false)
let dragStart = null
let pinchStart = null

const nodeById = computed(() => new Map(props.nodes.map((n) => [n.id, n])))

const visibleEdges = computed(() =>
  props.edges.filter((e) => nodeById.value.has(e.source?.id || e.source) && nodeById.value.has(e.target?.id || e.target))
)

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
  return 10 + Math.sqrt(1 + (node.activity || 0)) * 3.4
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
function onTouchStart(e) {
  if (e.touches.length === 1) {
    if (e.target.closest('.star')) return
    dragging.value = true
    dragStart = { x: e.touches[0].clientX - view.x, y: e.touches[0].clientY - view.y }
  } else if (e.touches.length === 2) {
    dragging.value = false
    pinchStart = { d: dist(e.touches[0], e.touches[1]), scale: view.scale }
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
  const rect = viewportEl.value.getBoundingClientRect()
  view.scale = scale
  view.x = rect.width / 2 - node.x * scale
  view.y = rect.height / 2 - node.y * scale
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
    const rect = viewportEl.value.getBoundingClientRect()
    view.x = rect.width / 2
    view.y = rect.height / 2
  }
  window.addEventListener('pointerup', onPointerUp)
})
onBeforeUnmount(() => window.removeEventListener('pointerup', onPointerUp))
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
    <div class="galaxy-field" :style="{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }">
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
        v-for="node in nodes"
        :key="node.id"
        :node="node"
        :radius="radiusFor(node)"
        :selected="node.id === selectedId"
        @select="(n) => emit('select-star', n)"
      />
    </div>
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
</style>

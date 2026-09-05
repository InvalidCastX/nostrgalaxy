<script setup>
defineProps({
  node: { type: Object, required: true },
  radius: { type: Number, default: 18 },
  selected: { type: Boolean, default: false },
  rotation: { type: Number, default: 0 } // current galaxy rotation, in degrees — labels counter-rotate to stay upright
})
defineEmits(['select'])
</script>

<template>
  <button
    class="star"
    :class="[`star--${node.color}`, { 'star--selected': selected }]"
    :style="{
      left: node.x + 'px',
      top: node.y + 'px',
      '--r': radius + 'px',
      '--label-rot': -rotation + 'deg'
    }"
    @click.stop="$emit('select', node)"
    :aria-label="node.name || 'unnamed Nostr identity'"
  >
    <span class="star__visual">
      <span class="star__glow" aria-hidden="true"></span>
      <span class="star__body" aria-hidden="true">
        <img
          v-if="node.picture"
          :src="node.picture"
          class="star__avatar"
          loading="lazy"
          alt=""
          @error="$event.target.style.display = 'none'"
        />
        <span v-else class="star__spark">✦</span>
      </span>
      <span v-if="node.nip05Verified" class="star__badge" aria-hidden="true">✓</span>
      <span class="star__label">{{ node.name || node.id.slice(0, 8) }}</span>
    </span>
  </button>
</template>

<style scoped>
.star {
  position: absolute;
  transform: translate(-50%, -50%);
  width: calc(var(--r) * 2);
  height: calc(var(--r) * 2);
  min-width: 40px;
  min-height: 40px;
  border: none;
  background: none;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: inherit;
  touch-action: manipulation;
}

.star__visual {
  position: relative;
  width: calc(var(--r) * 2);
  height: calc(var(--r) * 2);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.star__glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: calc(var(--r) * 2 * 1.4);
  height: calc(var(--r) * 2 * 1.4);
  border-radius: 50%;
  filter: blur(6px);
  opacity: 0.55;
  pointer-events: none;
}

.star__body {
  position: relative;
  width: calc(var(--r) * 2);
  height: calc(var(--r) * 2);
  flex-shrink: 0;
  border-radius: 50%;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-panel-solid);
  border: 1.5px solid currentColor;
  box-shadow: 0 0 10px 1px currentColor;
}

.star--purple { color: var(--c-purple); }
.star--green { color: var(--c-green); }
.star--gold { color: var(--c-gold); }
.star--blue { color: var(--c-blue); }
.star--red { color: var(--c-red); }

.star--purple .star__glow { background: var(--c-purple); }
.star--green .star__glow { background: var(--c-green); }
.star--gold .star__glow { background: var(--c-gold); }
.star--blue .star__glow { background: var(--c-blue); }
.star--red .star__glow { background: var(--c-red); }

.star__avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.star__spark {
  font-size: calc(var(--r) * 0.9);
  line-height: 1;
}

.star__badge {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--c-gold);
  color: #1a1305;
  font-size: 9px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
}

.star__label {
  position: absolute;
  top: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%) rotate(var(--label-rot, 0deg));
  transform-origin: center top;
  font-size: 11px;
  color: var(--dim);
  white-space: nowrap;
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
}

.star--selected .star__body {
  box-shadow: 0 0 0 2px var(--star-white), 0 0 16px 3px currentColor;
}
.star--selected .star__label {
  color: var(--star-white);
}

/* Blurred glows are noticeably more expensive to paint on phone GPUs than
   on a laptop's — this is the primary surface, so trim it there rather
   than uniformly softening it for everyone. */
@media (pointer: coarse) {
  .star__glow {
    filter: blur(3px);
    opacity: 0.45;
  }
}
</style>

// galaxy.js — turns raw Nostr events into a galaxy: stars (users),
// gravitational links (observed interactions), and constellations
// (loosely detected community clusters).
//
// Nothing here invents popularity scores. Sizes and colors are derived
// only from events actually observed in the loaded window.

import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force'

const BCH_TAGS = ['bch', 'bitcoincash', 'cashtokens', 'cashtoken', 'bchnostr']

export function extractHashtags(event) {
  const fromTags = (event.tags || [])
    .filter((t) => t[0] === 't' && t[1])
    .map((t) => t[1].toLowerCase())
  const fromContent = (event.content || '').match(/#(\w+)/g) || []
  return new Set([...fromTags, ...fromContent.map((h) => h.slice(1).toLowerCase())])
}

/**
 * Builds the star/link graph from raw kind 0/1/6/7 events.
 * profiles: Map<pubkey, kind0 event>
 * notes: kind 1 events
 * reposts: kind 6 events
 * reactions: kind 7 events
 */
export function buildGalaxy({ profiles, notes = [], reposts = [], reactions = [] }, { nowSec = Date.now() / 1000 } = {}) {
  const nodes = new Map() // pubkey -> node

  function ensureNode(pubkey) {
    if (!nodes.has(pubkey)) {
      nodes.set(pubkey, {
        id: pubkey,
        name: null,
        picture: null,
        nip05: null,
        about: null,
        nip05Verified: false,
        firstSeen: null,
        lastActive: null,
        noteCount: 0,
        replyCount: 0,
        reactionsReceived: 0,
        hashtags: new Map(), // tag -> count
        bchScore: 0
      })
    }
    return nodes.get(pubkey)
  }

  // --- profiles (kind 0) ---
  for (const [pubkey, event] of profiles) {
    const node = ensureNode(pubkey)
    let meta = {}
    try {
      meta = JSON.parse(event.content || '{}')
    } catch {
      meta = {}
    }
    node.name = meta.display_name || meta.name || null
    node.picture = meta.picture || null
    node.about = meta.about || null
    node.nip05 = meta.nip05 || null
    node.profileEventCreatedAt = event.created_at
  }

  // --- links accumulate here before becoming edges ---
  const linkWeights = new Map() // "a|b" (sorted) -> { weight, kinds: Set }

  function addLink(a, b, weight, kind) {
    if (!a || !b || a === b) return
    const key = a < b ? `${a}|${b}` : `${b}|${a}`
    if (!linkWeights.has(key)) linkWeights.set(key, { a: a < b ? a : b, b: a < b ? b : a, weight: 0, kinds: new Set() })
    const l = linkWeights.get(key)
    l.weight += weight
    l.kinds.add(kind)
  }

  // --- notes (kind 1): activity, replies, mentions, hashtags ---
  for (const event of notes) {
    const author = ensureNode(event.pubkey)
    author.noteCount += 1
    author.firstSeen = author.firstSeen ? Math.min(author.firstSeen, event.created_at) : event.created_at
    author.lastActive = author.lastActive ? Math.max(author.lastActive, event.created_at) : event.created_at

    const tags = extractHashtags(event)
    for (const tag of tags) {
      author.hashtags.set(tag, (author.hashtags.get(tag) || 0) + 1)
      if (BCH_TAGS.includes(tag)) author.bchScore += 1
    }

    const eTags = (event.tags || []).filter((t) => t[0] === 'e')
    const pTags = (event.tags || []).filter((t) => t[0] === 'p')

    if (eTags.length > 0) {
      author.replyCount += 1
      // Reply target: prefer a tag explicitly marked "reply", else the last e-tag.
      const marked = eTags.find((t) => t[3] === 'reply') || eTags[eTags.length - 1]
      // We don't have the parent's author from the tag alone (only event id),
      // so mentions (p-tags) are our reliable signal for "who this note is about".
      void marked
    }
    for (const pTag of pTags) {
      const mentioned = pTag[1]
      if (mentioned) {
        ensureNode(mentioned)
        const weight = eTags.length > 0 ? 3 : 1 // reply-context mention vs plain mention
        addLink(event.pubkey, mentioned, weight, eTags.length > 0 ? 'reply' : 'mention')
      }
    }
  }

  // --- reposts (kind 6): treat like a strong mention ---
  for (const event of reposts) {
    const author = ensureNode(event.pubkey)
    author.lastActive = author.lastActive ? Math.max(author.lastActive, event.created_at) : event.created_at
    const pTag = (event.tags || []).find((t) => t[0] === 'p')
    if (pTag && pTag[1]) addLink(event.pubkey, pTag[1], 2, 'repost')
  }

  // --- reactions (kind 7): weakest link, plus a received-reaction count ---
  for (const event of reactions) {
    const author = ensureNode(event.pubkey)
    author.lastActive = author.lastActive ? Math.max(author.lastActive, event.created_at) : event.created_at
    const pTag = (event.tags || []).find((t) => t[0] === 'p')
    if (pTag && pTag[1]) {
      const target = ensureNode(pTag[1])
      target.reactionsReceived += 1
      addLink(event.pubkey, pTag[1], 0.5, 'reaction')
    }
  }

  // --- shared-topic edges: light-weight, only for pairs with real overlap ---
  const taggedNodes = [...nodes.values()].filter((n) => n.hashtags.size > 0)
  for (let i = 0; i < taggedNodes.length; i++) {
    for (let j = i + 1; j < taggedNodes.length; j++) {
      const a = taggedNodes[i]
      const b = taggedNodes[j]
      let shared = 0
      for (const tag of a.hashtags.keys()) if (b.hashtags.has(tag)) shared += 1
      if (shared >= 2) addLink(a.id, b.id, Math.min(shared * 0.3, 1.5), 'topic')
    }
  }

  // --- finalize node visuals: color category + size ---
  const THIRTY_DAYS = 30 * 24 * 60 * 60
  const NINETY_DAYS = 90 * 24 * 60 * 60

  for (const node of nodes.values()) {
    node.nip05Verified = !!node.nip05
    node.activity = node.noteCount + node.replyCount * 0.5 + node.reactionsReceived * 0.2
    const age = node.firstSeen ? nowSec - node.firstSeen : null
    const stale = node.lastActive ? nowSec - node.lastActive : null

    if (node.nip05Verified) {
      node.color = 'gold'
    } else if (node.bchScore > 0) {
      node.color = 'green'
    } else if (stale !== null && stale > NINETY_DAYS) {
      node.color = 'red'
    } else if (age !== null && age < THIRTY_DAYS) {
      node.color = 'blue'
    } else {
      node.color = 'purple'
    }

    node.topHashtags = [...node.hashtags.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([tag]) => tag)
  }

  const edges = [...linkWeights.values()].map((l) => ({
    source: l.a,
    target: l.b,
    weight: l.weight,
    strength: l.weight >= 4 ? 'strong' : l.weight >= 1.5 ? 'medium' : 'weak',
    kinds: [...l.kinds]
  }))

  return { nodes: [...nodes.values()], edges }
}

/**
 * Very lightweight community detection: connected components of the
 * "medium" + "strong" edge subgraph, reported as "possible" clusters —
 * never asserted as an official group.
 */
export function detectConstellations(nodes, edges, { minSize = 3 } = {}) {
  const parent = new Map(nodes.map((n) => [n.id, n.id]))
  function find(x) {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)))
      x = parent.get(x)
    }
    return x
  }
  function union(a, b) {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }

  for (const e of edges) {
    if (e.strength === 'weak') continue
    if (parent.has(e.source) && parent.has(e.target)) union(e.source, e.target)
  }

  const groups = new Map()
  for (const n of nodes) {
    const root = find(n.id)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(n)
  }

  const clusters = [...groups.values()]
    .filter((members) => members.length >= minSize)
    .map((members) => {
      const tagCounts = new Map()
      for (const m of members) {
        for (const tag of m.topHashtags) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
      }
      const topTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t)
      const label = topTags.length ? `#${topTags.join(' #')}` : 'unlabeled activity'
      return { members, label: `Possible community cluster: ${label}`, size: members.length }
    })
    .sort((a, b) => b.size - a.size)

  return clusters
}

/**
 * Runs a force simulation to lay stars out in 2D space, and returns
 * a promise that resolves once it has settled (ticked synchronously,
 * so this is fast for MVP-scale graphs of a few hundred nodes).
 */
export function layoutGalaxy(nodes, edges, { width = 2000, height = 1400, ticks = 300 } = {}) {
  const simNodes = nodes.map((n) => ({ ...n }))
  const idIndex = new Map(simNodes.map((n) => [n.id, n]))
  const simLinks = edges
    .filter((e) => idIndex.has(e.source) && idIndex.has(e.target))
    .map((e) => ({ ...e }))

  const sim = forceSimulation(simNodes)
    .force(
      'link',
      forceLink(simLinks)
        .id((d) => d.id)
        .distance((l) => 260 - Math.min(l.weight, 10) * 18)
        .strength((l) => Math.min(0.05 + l.weight * 0.02, 0.4))
    )
    .force('charge', forceManyBody().strength(-120))
    .force('center', forceCenter(0, 0))
    .force(
      'collide',
      forceCollide((d) => 14 + Math.sqrt(1 + d.activity) * 4)
    )
    .stop()

  for (let i = 0; i < ticks; i++) sim.tick()

  return simNodes
}

# Nostr Galaxy Map

A visual explorer of the Nostr / BCHNostr ecosystem. Users appear as glowing
stars, observed interactions (replies, mentions, reposts, reactions, shared
topics) appear as gravitational links, and loosely-connected groups surface
as "possible" constellations.

Companion apps:
- **BCHNostr LiveGrid** — network activity observatory
- **NostrCards** — identity/profile cards (this app links out to
  `https://nostrcard.vercel.app/p/<npub>` when you click a star)

This is a read-only explorer. It never asks for a private key, seed phrase,
or wallet connection — it only reads public events from relays over
WebSocket.

## Stack

- Vite + Vue 3 (`<script setup>`), plain CSS — no TypeScript, no Tailwind
- `d3-force` for the galaxy layout simulation
- A small hand-rolled NIP-01 WebSocket client (`src/nostr.js`) — no other
  Nostr library dependency
- No backend, no database — everything runs client-side against public
  relays

## Getting started

```bash
npm install
npm run dev
```

Then open the printed local URL. Click **Enter Galaxy** to connect to the
default relays and start rendering real profiles and activity.

```bash
npm run build      # production build in dist/
npm run preview    # preview the production build locally
```

## Deploying

**Vercel** — import the repo, framework preset "Vite", no config needed.

**GitHub Pages** — `vite.config.js` already sets `base: './'` so a build
works from a project subpath. Run `npm run build`, then publish the `dist/`
folder (e.g. via the `gh-pages` package or a GitHub Actions workflow).

## Configuring relays and limits

Edit `DEFAULT_RELAYS` in `src/nostr.js`:

```js
const DEFAULT_RELAYS = [
  'wss://relay.bchnostr.com',
  'wss://relay.nos.lol',
  'wss://relay.damus.io',
  'wss://nos.lol'
]
```

One relay being offline never breaks the app — each relay connects
independently and the pool merges + de-duplicates whatever comes back.

MVP load limits live at the top of `src/App.vue`:

```js
const MAX_PROFILES = 500
const MAX_EVENTS = 5000
```

## How the galaxy is built

1. `src/nostr.js` opens a `RelayPool` and subscribes to kind 0 (profiles),
   kind 1 (notes), kind 6 (reposts), and kind 7 (reactions).
2. `src/galaxy.js` (`buildGalaxy`) turns those raw events into stars and
   weighted links: replies and mentions inside replies are the strongest
   signal, plain mentions and reposts are medium, reactions and shared
   hashtags are the weakest. No follower-graph (kind 3) is used for the
   MVP layout, since Nostr follow lists are often incomplete.
3. `layoutGalaxy` runs a `d3-force` simulation (link + charge + collide
   forces) to position every star in 2D space.
4. `detectConstellations` finds connected components of the medium/strong
   edge subgraph and labels them "Possible community cluster: #topic" —
   never asserted as an official group.
5. Star color is derived only from observed data: gold = NIP-05 verified,
   green = BCH-related activity seen, blue = new (first seen < 30 days
   ago), red = inactive (no activity for 90+ days), purple = general Nostr
   activity otherwise. Star size reflects observed note/reply/reaction
   volume — never a synthetic popularity score.

## Project layout

```
src/
  App.vue              landing page, relay lifecycle, orbit mode, layout
  main.js
  style.css            design tokens (color, type)
  nostr.js             WebSocket relay pool + npub/nprofile decoding
  galaxy.js            event graph -> nodes/edges, clustering, force layout
  components/
    GalaxyView.vue      pan/zoom/drag star field + link rendering
    StarNode.vue         a single glowing star
    ProfilePopup.vue     mini NostrCard preview + link to the full card
    SearchBox.vue        search by name / npub / nprofile / NIP-05
```

## Not included in this MVP

Kept out on purpose, per the build plan — architecture leaves room to add
them later without a rewrite:

- Time Travel Mode (timeline scrubber over historical state)
- Kind 3 (follow list) based relationships
- Zap (kind 9735) weighted connections

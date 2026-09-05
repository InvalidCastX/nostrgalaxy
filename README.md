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

## Deploying to GitHub Pages

A ready-made workflow at `.github/workflows/deploy.yml` builds the app and
publishes it automatically on every push to `main` — no third-party
service involved, just GitHub itself.

1. **Push this project to a GitHub repo**, if you haven't already:
   ```bash
   cd nostr-galaxy-map
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<your-username>/<your-repo>.git
   git push -u origin main
   ```
   (Skip `git init`/`branch`/`remote` if it's already a git repo — just
   commit and push.)

2. **Turn on Pages, pointed at GitHub Actions:**
   In your repo, go to **Settings → Pages**. Under "Build and deployment",
   set **Source** to **GitHub Actions**. That's it — no branch to pick, no
   folder to configure.

3. **Push (or re-push) to `main`.** That push triggers the workflow: it
   runs `npm ci && npm run build`, then publishes the `dist/` folder. Watch
   it run under the **Actions** tab in your repo — it takes under a
   minute. When it finishes, your **Settings → Pages** page shows the live
   URL, typically:
   ```
   https://<your-username>.github.io/<your-repo>/
   ```

4. **Future updates** — just `git push` to `main` again; the workflow
   rebuilds and redeploys automatically. You can also trigger it manually
   from the Actions tab (`workflow_dispatch` is enabled).

Nothing else needs changing for this to work: `vite.config.js` already
sets `base: './'`, so the build's asset paths are relative and work
correctly from a project subpath like `/<your-repo>/` — no repo-name-specific
config needed.

If you'd rather not use Actions, the manual alternative is: run
`npm run build` locally, then publish the `dist/` folder to a `gh-pages`
branch (the `gh-pages` npm package automates this: `npx gh-pages -d dist`
after installing it as a dev dependency) — but the Actions workflow above
does the same thing automatically on every push, so most people won't need
this.

## Lazy loading

The first load pulls a small batch (120 profiles, a few hundred recent
notes/reposts/reactions) so the galaxy appears fast. A **"Load more stars"**
control (bottom right, once connected) pulls in the next slice — older
profiles, and notes paged further back in time via `until` — up to the
`MAX_PROFILES` / `MAX_EVENTS` ceiling. Nothing pulls in the whole network
up front.

Two more things keep it smooth as the galaxy grows:

- **Warm-started layout** — `layoutGalaxy` *pins* each star's previous
  position across rebuilds (d3's `fx`/`fy`) instead of merely reheating it,
  so already-placed stars hold completely still once settled — only
  genuinely new stars are free to move into place. This is also why
  tapping a star reliably selects it now, instead of chasing a star that's
  still drifting from the last batch.
- **Viewport culling** — `GalaxyView.vue` only mounts stars that are
  actually on screen (plus a small margin), with a hard ceiling
  (`MAX_RENDERED_STARS`) if you're zoomed out far enough to see hundreds
  at once. Panning/zooming re-derives the visible set cheaply; it never
  re-renders the whole galaxy's worth of DOM nodes at once.

## Mobile controls

- **Drag** with one finger to pan, **pinch** to zoom.
- **Twist with two fingers** to rotate the map (same gesture as Google/Apple
  Maps) — a small compass in the middle-right edge shows the current
  heading and resets rotation to north on tap.
- On desktop, mouse-wheel zooms; **Shift + scroll** rotates.
- Star collision spacing was widened and tap targets have a 40px minimum,
  so accounts should no longer visually overlap or be hard to hit with a
  finger.

## Configuring relays, the NostrCard domain, and limits

All of this lives in `public/config.json`, fetched at startup — so it can be
edited (or swapped per deployment) **without a rebuild**:

```json
{
  "relays": [
    "wss://relay.bchnostr.com",
    "wss://relay.nos.lol",
    "wss://relay.damus.io",
    "wss://nos.lol"
  ],
  "nostrCardBaseUrl": "https://nostrcard.vercel.app/#/p/",
  "maxProfiles": 500,
  "maxEvents": 5000,
  "initialProfileLimit": 120,
  "initialNoteLimit": 400,
  "initialRepostLimit": 150,
  "initialReactionLimit": 250,
  "loadMoreStep": 120
}
```

- `nostrCardBaseUrl` is prepended to each user's `npub` when the "Open Full
  NostrCard" button is built — it currently points at NostrCard's hash-route
  pattern (`.../#/p/npub1...`); update it here if that ever changes.
- If `config.json` is missing or fails to load (e.g. offline), the app falls
  back to the defaults baked into `src/App.vue`, so it's never a hard
  dependency.
- One relay being offline never breaks the app — each relay connects
  independently and the pool merges + de-duplicates whatever comes back.

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
public/
  config.json          relays, NostrCard domain, load limits — edit without a rebuild
```

## Not included in this MVP

Kept out on purpose, per the build plan — architecture leaves room to add
them later without a rewrite:

- Time Travel Mode (timeline scrubber over historical state)
- Kind 3 (follow list) based relationships
- Zap (kind 9735) weighted connections

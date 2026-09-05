// image.js — turns an arbitrary user-supplied avatar URL into a small,
// resized version before it ever hits the wire.
//
// Nostr profile pictures can point to anything (a 4000px banner photo,
// a multi-MB PNG, whatever the user uploaded) but every place we show
// one in this app renders it at 40-90px. Without resizing, the browser
// downloads the full original just to shrink it in CSS — which is the
// single biggest driver of mobile data usage in this app.
//
// wsrv.nl is a free, widely-used image proxy/CDN (backed by images.weserv.nl)
// that resizes-on-the-fly and caches the result. If it's ever unreachable,
// callers already have an @error handler on the <img> that just hides the
// broken image, same as before this existed.

const PROXY_BASE = 'https://wsrv.nl/'

/**
 * Returns a URL that fetches `url` resized to roughly `size` px square.
 * Falls back to the original URL for data: URIs or if `url` is empty,
 * since those aren't worth (or able to be) proxied.
 */
export function avatarThumb(url, size = 64) {
  if (!url) return null
  if (url.startsWith('data:')) return url
  const px = Math.round(size * (typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1))
  const params = new URLSearchParams({
    url,
    w: String(px),
    h: String(px),
    fit: 'cover',
    a: 'attention', // crop toward the most "interesting" part of the image rather than dead-center
    output: 'webp',
    q: '75'
  })
  return `${PROXY_BASE}?${params.toString()}`
}

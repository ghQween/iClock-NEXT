// @ts-nocheck
'use strict';

// iClock service worker — app-shell caching with update notification.
// All URLs are relative to the SW scope so this works at origin root or a
// GitHub Pages subpath (e.g. /iClock/).

// Every cache this app owns starts with this, and the activate handler below
// deletes ONLY these. Cache Storage is scoped to the ORIGIN, not to the
// service worker's scope, so a sweep of "everything that isn't my current
// cache" reaches other applications' data. That is not hypothetical here: the
// comment above describes serving from a GitHub Pages subpath, and project
// Pages sites all share one origin (user.github.io/iClock sits alongside
// user.github.io/anything-else). Verified before this filter existed — a
// neighbouring cache and its contents were destroyed by the first iClock
// release after it was created.
const CACHE_PREFIX = 'iclock-shell-';

// __BUILD_VERSION__ is replaced by scripts/build.js with a content hash of the
// precached assets. Without it, a release that changes only app.js/styles.css/
// index.html produces a byte-identical sw.js, the browser sees no SW update,
// and installed users stay pinned to the old shell forever. In dev (serving
// src/ directly) the placeholder is constant — fine, dev has no update story.
//
// Deliberately ONE literal rather than CACHE_PREFIX + '__BUILD_VERSION__':
// build.js replaces the whole token textually. It also asserts the stamped
// name still starts with CACHE_PREFIX, so the two cannot drift apart and
// quietly disable cleanup of old iClock shells.
const CACHE_NAME = 'iclock-shell-335ddfdcb345';

const PRECACHE = [
  './',
  './index.html',
  './app.js',
  './styles.css',
  './manifest.webmanifest',
  './assets/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
  );
  // Deliberately NO skipWaiting() here. Activating on install would swap the
  // controlling worker — and, via the activate handler below, delete the old
  // cache generation — underneath a page still running the old shell, and it
  // would do so whether or not the page decided this worker is an update. The
  // page is the one that knows (app.js gates on an existing controller), so
  // activation waits for its SKIP_WAITING message, handled at the bottom of
  // this file. A first-ever install has no waiting to skip, so this costs
  // nothing on the fresh-visit path.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Prefix first: see CACHE_PREFIX. Scoping this way means renaming
            // the prefix would orphan the previous generation of iClock caches
            // rather than clearing them — an acceptable trade against deleting
            // a cohosted app's data, and the build guard makes an accidental
            // rename impossible.
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

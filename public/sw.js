const CACHE_NAME = "termix-static-v2";
const BASE_PATH = "__TERMIX_SW_BASE_PATH__";
const STATIC_ASSETS = [
  `${BASE_PATH}/favicon.ico`,
  `${BASE_PATH}/icons/48x48.png`,
  `${BASE_PATH}/icons/128x128.png`,
  `${BASE_PATH}/icons/256x256.png`,
  `${BASE_PATH}/icons/512x512.png`,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        return self.skipWaiting();
      }),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => {
              return caches.delete(name);
            }),
        );
      })
      .then(() => {
        return self.clients.claim();
      }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== "GET") {
    return;
  }

  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/ws")) {
    return;
  }

  if (
    url.pathname.startsWith("/host/opkssh-chooser/") ||
    url.pathname.startsWith("/host/opkssh-callback/")
  ) {
    return;
  }

  if (url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request));
    return;
  }

  const isStaticAsset = STATIC_ASSETS.some((asset) => url.pathname === asset);

  if (!isStaticAsset) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") {
          return response;
        }

        const responseClone = response.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(request, responseClone);
        });

        return response;
      });
    }),
  );
});

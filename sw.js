"use strict";

/* ============================================================
   서비스 워커 — 오프라인에서도 앱이 열리게 한다

   출석은 지하 체육관·지하철·비행기에서 찍는다. 기록은 localStorage 에 있는데 정작
   **앱 껍데기를 못 받아와 화면 자체가 안 뜨는 것**이 이 파일이 없을 때의 문제였다.

   전략은 stale-while-revalidate 하나다.
   - 캐시에 있으면 **즉시** 준다 (네트워크를 기다리지 않는다 → 실행이 항상 빠르다)
   - 동시에 뒤에서 새로 받아 캐시를 갱신한다 → 다음 실행부터 최신 코드
   - 캐시에 없으면 네트워크로 가고, 그것도 실패하면 내비게이션은 index.html 로 되돌린다

   network-first 로 하면 새 코드를 즉시 받지만 느린 회선에서 매번 기다린다.
   cache-first(갱신 없음)로 하면 빠르지만 버전을 손으로 올리기 전까지 영영 옛 코드가 남는다.
   이 앱은 배포가 「파일을 푸시」 하나뿐이라, 손으로 올리는 것을 잊는 쪽이 더 위험하다.
   ============================================================ */

const CACHE = "mat-time-v1";

/* 앱 셸. 하나라도 빠지면 그 자원만 오프라인에서 실패한다 (앱이 통째로 죽지는 않는다) */
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "notes.js",
  "sync.js",
  "share-card.js",
  "main.js",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png"
];

self.addEventListener("install", e => {
  // 개별 실패가 전체 설치를 막지 않게 하나씩 넣는다 (파일 하나 이름이 바뀌어도 설치는 된다)
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(u => cache.add(u).catch(err => console.warn("캐시 실패", u, err))));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(n => n !== CACHE).map(n => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", e => {
  const req = e.request;

  // GET 만, 그리고 같은 출처만 다룬다.
  // api.github.com 은 **절대** 캐시하면 안 된다 — 동기화가 옛 Gist 를 읽고 병합해 버린다.
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });

    const fresh = fetch(req).then(res => {
      // 부분 응답(206)·오류는 캐시에 넣지 않는다 — 넣으면 깨진 파일이 고착된다
      if (res && res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => null);

    if (hit) return hit;                       // 있으면 기다리지 않는다
    const res = await fresh;
    if (res) return res;

    // 오프라인 첫 진입 등 — 주소가 어떻든 내비게이션은 앱 껍데기로 되돌린다
    if (req.mode === "navigate") {
      const shell = await cache.match("index.html") || await cache.match("./");
      if (shell) return shell;
    }
    return new Response("오프라인입니다", { status: 503, statusText: "Offline" });
  })());
});

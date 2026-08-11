"use strict";

/* ============================================================
   기기 간 동기화 — GitHub Gist
   토큰은 state 와 분리해 별도 키에 보관한다 (백업 파일에 섞이지 않도록).

   한 gist 안의 두 파일을 다룬다. 병합 자체는 각 문서의 소유 파일이 맡고
   (mergeStates/sameState → app.js, mergeNotes/sameNotes → notes.js)
   여기서는 읽고 · 엮고 · 바뀐 파일만 올린다.
   ============================================================ */

const SYNC_KEY = "bjj-attendance-sync";
const GIST_FILE = "bjj-attendance.json";
const NOTES_FILE = "bjj-notes.json";
const GIST_DESC = "주짓수 출석 트래커 기록";

let sync = { token: "", gistId: "", lastSync: "" };
let syncStatus = { kind: "off", msg: "" };   // off | ok | busy | err
let syncTimer = null;

function loadSync() {
  try {
    const raw = localStorage.getItem(SYNC_KEY);
    if (raw) Object.assign(sync, JSON.parse(raw));
  } catch (e) { /* 손상된 값은 무시하고 미연결 상태로 시작 */ }
}
function saveSync() {
  try { localStorage.setItem(SYNC_KEY, JSON.stringify(sync)); } catch (e) {}
}
const syncOn = () => !!(sync.token && sync.gistId);

async function gh(path, opts = {}) {
  const headers = { "Accept": "application/vnd.github+json",
                    "Authorization": "Bearer " + sync.token };
  if (opts.body) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch("https://api.github.com" + path, { ...opts, headers });
  } catch (e) {
    throw new Error("네트워크에 연결할 수 없습니다");
  }
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? "토큰이 유효하지 않거나 만료되었습니다"
      : res.status === 403 ? "권한이 없습니다 — 토큰에 gist 권한이 있는지 확인하세요"
      : res.status === 404 ? "Gist를 찾을 수 없습니다 — 연결을 해제하고 다시 연결하세요"
      : "깃허브 오류 " + res.status);
  }
  return res.json();
}

/** Gist 파일 하나를 읽어 파싱. 없으면 null */
async function readGistFile(gist, name, parse) {
  const f = gist.files && gist.files[name];
  if (!f) return null;
  // 1MB 초과 시 content 가 잘리고 truncated=true — 코어 파일은 분리 덕에 여기 닿지 않는다
  try {
    const text = f.truncated ? await (await fetch(f.raw_url)).text() : f.content;
    return parse(JSON.parse(text));
  } catch (e) {
    return null;
  }
}

const coreJson = () => JSON.stringify(state, null, 2);
const notesJson = () => JSON.stringify(noteDoc, null, 2);

/*
 * 계정의 gist 를 훑어 우리 것을 찾는다.
 *
 * 한 페이지(100개)만 보면 gist 를 많이 가진 계정에서 기존 기록을 놓치고 **새 gist 를 만든다** —
 * 사용자 눈에는 "다른 기기 기록이 안 따라온다 = 유실" 로 보인다. 그래서 찾을 때까지 넘긴다.
 * 상한을 두는 이유는 못 찾는 계정에서 무한히 요청하지 않기 위해서다.
 */
const GIST_PAGES_MAX = 10;      // 최대 1,000개까지 훑는다

async function findGist() {
  for (let page = 1; page <= GIST_PAGES_MAX; page++) {
    const list = await gh(`/gists?per_page=100&page=${page}`);
    // 탐색 기준은 코어 파일 — 메모 파일이 없는 기존 gist 도 그대로 찾아낸다
    const hit = list.find(g => g.files && g.files[GIST_FILE]);
    if (hit) return hit;
    if (list.length < 100) return null;        // 마지막 페이지
  }
  return null;
}

/** 토큰으로 기존 Gist 를 찾고, 없으면 새로 만든다 */
async function connectSync(token) {
  sync.token = token.trim();
  setSyncStatus("busy", "연결 중…");
  try {
    const found = await findGist();
    if (found) {
      sync.gistId = found.id;
    } else {
      const created = await gh("/gists", {
        method: "POST",
        body: JSON.stringify({
          description: GIST_DESC, public: false,
          files: { [GIST_FILE]:  { content: coreJson() },
                   [NOTES_FILE]: { content: notesJson() } }
        })
      });
      sync.gistId = created.id;
    }
    saveSync();
    await syncNow(true);
    toast(found ? "기존 기록을 이어받았습니다" : "동기화를 시작합니다");
  } catch (e) {
    sync.token = ""; sync.gistId = "";
    setSyncStatus("err", e.message);
    render();
  }
}

/*
 * 동기화는 한 번에 하나만 돈다.
 *
 * 트리거가 넷이라(디바운스 · 앱 복귀 · 수동 버튼 · 부팅) 겹치기 쉬운데, 겹치면 두 실행이
 * 같은 원격을 읽고 각자 PATCH 해서 나중에 도착한 쪽이 먼저 것을 지운다. 로컬은 온전하므로
 * 다음 동기화에서 회복되지만, 그때까지 Gist 가 뒤처지고 요청만 두 배로 나간다.
 * 돌고 있는 동안 들어온 요청은 버리지 않고 끝난 뒤 한 번 더 돌린다 (마지막 변경이 유실되지 않게).
 */
let syncBusy = 0;          // 불리언이 아니라 카운터 — 덮어쓰기와 겹쳐도 중간에 열리지 않는다
let syncAgain = false;

/** 원격을 읽어 병합하고, 달라진 게 있으면 올린다 */
async function syncNow(manual = false) {
  if (!syncOn()) return;
  if (syncBusy) { syncAgain = true; return; }
  syncBusy++;
  setSyncStatus("busy", "동기화 중…");
  try {
    const gist = await gh("/gists/" + sync.gistId);
    const remoteCore = await readGistFile(gist, GIST_FILE, normalize);
    const remoteNotes = await readGistFile(gist, NOTES_FILE, normalizeNotes);

    const mergedCore = remoteCore ? mergeStates(state, remoteCore) : { ...state };
    const mergedNotes = remoteNotes ? mergeNotes(noteDoc, remoteNotes) : { ...noteDoc };

    if (!sameState(state, mergedCore)) { state = mergedCore; writeLocal(); }
    if (!sameNotes(noteDoc, mergedNotes)) { noteDoc = mergedNotes; writeNotesLocal(); }

    /*
     * 바뀐 파일만 올린다 — 문서를 나눈 이유가 여기서 실현된다.
     * 출석만 체크하면 코어(수십 KB)만 올라가고 메모(수백 KB)는 그대로 둔다.
     */
    const files = {};
    if (!remoteCore || !sameState(remoteCore, state)) files[GIST_FILE] = { content: coreJson() };
    if (!remoteNotes || !sameNotes(remoteNotes, noteDoc)) files[NOTES_FILE] = { content: notesJson() };
    if (Object.keys(files).length) {
      await gh("/gists/" + sync.gistId, {
        method: "PATCH",
        body: JSON.stringify({ description: GIST_DESC, files })
      });
    }

    sync.lastSync = new Date().toISOString();
    saveSync();
    setSyncStatus("ok", "");
    render();
    if (manual) toast("동기화 완료");
  } catch (e) {
    setSyncStatus("err", e.message);
    render();
    if (manual) toast(e.message);
  } finally {
    syncBusy--;
    if (syncAgain) { syncAgain = false; scheduleSync(); }
  }
}

function scheduleSync() {
  if (!syncOn()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(false), 1500);
}

/**
 * 초기화·복원처럼 "덮어쓰기"가 의도된 경우. 병합하면 지운 기록이 원격에서
 * 되돌아오므로 원격을 현재 상태로 밀어버린다.
 *
 * 로컬 쓰기를 먼저 끝낸 뒤에 네트워크를 탄다 — 오프라인이거나 느려도 복원 결과는 남아야 한다.
 */
async function saveOverwrite() {
  const now = new Date().toISOString();
  state.updatedAt = now;
  noteDoc.updatedAt = now;
  writeLocal();
  writeNotesLocal();
  if (!syncOn()) return;

  clearTimeout(syncTimer);
  syncBusy++; syncAgain = false;          // 돌고 있던 병합이 이 덮어쓰기를 뒤엎지 못하게
  setSyncStatus("busy", "동기화 중…");
  try {
    /*
     * 세대를 원격 위로 올린다.
     *
     * 호출부는 "로컬과 파일 중 큰 쪽 + 1" 까지만 안다. 그런데 다른 기기가 이미 초기화해
     * 원격 세대가 더 높으면, 복원 결과가 낮은 세대로 올라가고 → 그 기기가 나중에 동기화할 때
     * newerEpoch 이 옛 문서를 골라 **복원이 통째로 되돌려진다.** 세대 장치를 둔 이유가
     * 바로 이 상황이므로 여기서 원격을 한 번 확인한다.
     */
    try {
      const gist = await gh("/gists/" + sync.gistId);
      const rc = await readGistFile(gist, GIST_FILE, normalize);
      const rn = await readGistFile(gist, NOTES_FILE, normalizeNotes);
      let bumped = false;
      if (rc && rc.epoch >= state.epoch) { state.epoch = rc.epoch + 1; bumped = true; }
      if (rn && rn.epoch >= noteDoc.epoch) { noteDoc.epoch = rn.epoch + 1; bumped = true; }
      if (bumped) { writeLocal(); writeNotesLocal(); }
    } catch (e) {
      // 읽지 못하면 호출부가 정한 세대로 그냥 올린다 (오프라인·권한 문제 등)
      console.warn("원격 세대를 확인하지 못했습니다", e);
    }

    await gh("/gists/" + sync.gistId, {
      method: "PATCH",
      body: JSON.stringify({
        description: GIST_DESC,
        files: { [GIST_FILE]:  { content: coreJson() },
                 [NOTES_FILE]: { content: notesJson() } }
      })
    });
    sync.lastSync = new Date().toISOString();
    saveSync();
    setSyncStatus("ok", "");
  } catch (e) {
    setSyncStatus("err", e.message);
    toast(e.message);
  } finally {
    syncBusy--;
  }
  render();
}

function disconnectSync() {
  if (!confirm("연결을 해제합니다. Gist에 저장된 기록은 남아 있고, 같은 토큰으로 다시 연결할 수 있습니다.")) return;
  sync = { token: "", gistId: "", lastSync: "" };
  localStorage.removeItem(SYNC_KEY);
  $("syncToken").value = "";
  setSyncStatus("off", "");
  render();
  toast("연결을 해제했습니다");
}

function setSyncStatus(kind, msg) {
  syncStatus = { kind, msg };
  renderSync();
}

function fmtSince(iso) {
  if (!iso) return "";
  const diff = Math.floor((new Date() - new Date(iso)) / 1000);
  if (diff < 60) return "방금";
  if (diff < 3600) return Math.floor(diff / 60) + "분 전";
  if (diff < 86400) return Math.floor(diff / 3600) + "시간 전";
  return Math.floor(diff / 86400) + "일 전";
}

function renderSync() {
  const on = syncOn();
  $("syncSetup").hidden = on;
  $("syncActive").hidden = !on;

  const box = $("syncState");
  const k = syncStatus.kind;
  box.className = "sync-state" + (on || k === "err" || k === "busy" ? " " + k : "");

  let msg;
  if (k === "busy") msg = syncStatus.msg || "동기화 중…";
  else if (k === "err") msg = syncStatus.msg;
  else if (on) msg = "깃허브 Gist에 백업 중" + (sync.lastSync ? ` · ${fmtSince(sync.lastSync)}` : "");
  else msg = "이 기기에만 저장됨 — 백업 안 됨";
  $("syncMsg").textContent = msg;

  $("footNote").textContent = on
    ? "기록이 깃허브 Gist에 백업됩니다. 다른 기기에서 같은 토큰으로 연결하면 이어집니다."
    : "데이터는 이 브라우저에만 저장됩니다. 설정에서 깃허브에 연결하거나 백업 파일을 받아 두세요.";
}

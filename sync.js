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

/** 토큰으로 기존 Gist 를 찾고, 없으면 새로 만든다 */
async function connectSync(token) {
  sync.token = token.trim();
  setSyncStatus("busy", "연결 중…");
  try {
    const list = await gh("/gists?per_page=100");
    // 탐색 기준은 코어 파일 — 메모 파일이 없는 기존 gist 도 그대로 찾아낸다
    const found = list.find(g => g.files && g.files[GIST_FILE]);
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

/** 원격을 읽어 병합하고, 달라진 게 있으면 올린다 */
async function syncNow(manual = false) {
  if (!syncOn()) return;
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
 */
async function saveOverwrite() {
  const now = new Date().toISOString();
  state.updatedAt = now;
  noteDoc.updatedAt = now;
  writeLocal();
  writeNotesLocal();
  if (!syncOn()) return;
  clearTimeout(syncTimer);
  setSyncStatus("busy", "동기화 중…");
  try {
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

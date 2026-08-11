"use strict";

/* ============================================================
   메모 — 출석과 별개로 그날 있었던 일을 적는다.

   문서 하나(bjj-notes)와 그 UI 전부를 담는다. app.js 다음에 로드되는 일반 스크립트라
   전역을 공유하며, app.js 의 상태·헬퍼(state · key · today · render · toast · $ …)를 쓴다.
   반대로 app.js 는 백업·달력 표식에서 이 파일의 값을 읽는다 — 양방향이지만 전부 호출 시점
   참조라 로드 순서에 걸리지 않는다. (파일을 나눈 이유는 docs/implementation.md 참조)
   ============================================================ */

/* ============================================================
   메모 분류
   사용자가 더하고 지울 수 있으므로 상수가 아니라 데이터다 (noteDoc.tags).
   아래는 처음 시작할 때의 초기값일 뿐이다.

   기본 분류의 id 는 영문이고 사용자가 만든 분류는 이름 자체가 id 다. 이름 변경 기능이
   없으므로 둘을 나눌 이유가 없고, 지웠다 같은 이름으로 다시 만들면 옛 메모와 다시 이어진다.
   ============================================================ */

const DEFAULT_TAGS = [
  { id: "class",   name: "수업" },
  { id: "seminar", name: "세미나" },
  { id: "comp",    name: "대회" },
  { id: "video",   name: "영상" },
  { id: "etc",     name: "기타" }
];
const MAX_TAGS = 10;          // 「전체」 칩은 필터 전용이라 여기 포함되지 않는다
const TAG_NAME_MAX = 10;      // 칩 한 줄에 들어가야 한다
const NOTE_MAX = 500;

const tagName = id => { const t = noteDoc.tags.find(x => x.id === id); return t ? t.name : id; };

/**
 * 「…로 / …으로」 조사. 분류 이름을 사용자가 정하므로 하드코딩할 수 없다.
 * 받침이 없거나 ㄹ 받침이면 「로」 (기타 → 기타로, 서울 → 서울로, 수업 → 수업으로).
 */
function toParticle(word) {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return "로";        // 한글 음절이 아니면 기본형
  const jong = c % 28;                        // 0 = 받침 없음, 8 = ㄹ
  return (jong === 0 || jong === 8) ? "로" : "으로";
}
const hasTag = id => noteDoc.tags.some(t => t.id === id);
/** 분류가 사라진 메모가 떨어질 자리. tags 는 항상 1개 이상이다 */
const fallbackTag = () => (noteDoc.tags[0] || DEFAULT_TAGS[0]).id;

/*
 * 메모 문서. 필드 이름을 백업 파일과 똑같이 맞춰 두어 localStorage · Gist · 백업 파일을
 * normalizeNotes() 하나로 읽는다 (noteDoc.notes 로 겹쳐 읽히는 건 그 대가).
 */
let noteDoc = {
  notes: {},          // "YYYY-MM-DD" → { text, tag, at }
  removedNotes: {},   // 삭제한 날짜 → 삭제 시각(ISO)
  tags: [],           // { id, name, at } — 표시 순서 그대로. 1~10개
  removedTags: {},    // 삭제한 분류 id → 삭제 시각(ISO)
  updatedAt: "",
  epoch: 0
};

/**
 * 메모 문서는 코어와 분리돼 있다 — 출석 한 번에 메모 전체를 다시 쓰지 않도록.
 * 코어의 load() 와 같은 규약: "ok" | "empty" | "corrupt". 손상된 원본은 지우지 않고 옮긴다.
 */
function loadNotes() {
  const raw = localStorage.getItem(NOTES_KEY);
  if (!raw) { noteDoc = normalizeNotes({}); return "empty"; }
  try {
    noteDoc = normalizeNotes(JSON.parse(raw));
    return "ok";
  } catch (e) {
    console.warn("메모를 읽지 못했습니다", e);
    stashCorrupt(NOTES_KEY, raw);
    noteDoc = normalizeNotes({});
    return "corrupt";
  }
}

const okTagId = k => typeof k === "string" && !!k && k.length <= TAG_NAME_MAX;

/**
 * 메모 문서 파싱. normalize() 와 같은 관용적 파서 — 이해할 수 없는 항목은 버리거나 보정한다.
 * 백업 파일도 같은 필드 이름을 쓰므로 이 함수 하나로 세 경로를 모두 읽는다.
 */
function normalizeNotes(d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) d = {};
  const removedNotes = stampMap(d.removedNotes);
  const removedTags = stampMap(d.removedTags, okTagId);
  const updatedAt = typeof d.updatedAt === "string" ? d.updatedAt : "";

  /*
   * 분류를 먼저 정리해야 메모의 tag 를 그 목록에 맞춰 보정할 수 있다.
   * 하나도 안 남으면 기본값으로 되돌린다 — 분류가 0개면 메모를 쓸 수 없다.
   */
  let tags = [];
  if (Array.isArray(d.tags)) {
    const seen = new Set();
    for (const t of d.tags) {
      if (!t || typeof t !== "object") continue;
      const id = typeof t.id === "string" ? t.id.trim() : "";
      const name = clip((typeof t.name === "string" ? t.name : "").trim(), TAG_NAME_MAX);
      if (!okTagId(id) || !name || seen.has(id) || removedTags[id]) continue;
      seen.add(id);
      // at 은 "이 분류를 만든 시각" — 없으면 문서 시각으로 확정한다.
      // 병합에서 삭제 툼스톤과 겨룰 값이 항목마다 있어야 지운 분류가 되살아나지 않는다
      tags.push(withAt({ id, name }, (typeof t.at === "string" && t.at) ? t.at : updatedAt));
      if (tags.length >= MAX_TAGS) break;
    }
  }
  if (!tags.length) tags = DEFAULT_TAGS.map(t => withAt({ ...t }, updatedAt));
  const tagSet = new Set(tags.map(t => t.id));

  const notes = {};
  const src = d.notes;
  if (src && typeof src === "object" && !Array.isArray(src)) {
    for (const [k, v] of Object.entries(src)) {
      if (!DATE_RE.test(k) || removedNotes[k]) continue;   // 취소가 이긴다 (출석·이력과 동일)
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const text = clip((typeof v.text === "string" ? v.text : "").trim(), NOTE_MAX);
      if (!text) continue;                                 // 빈 메모는 메모가 아니다
      notes[k] = {
        text,
        // 없어진 분류를 가리키면 첫 분류로 떨어뜨린다 (병합·손으로 만든 파일 대비)
        tag: tagSet.has(v.tag) ? v.tag : tags[0].id,
        // at 이 없으면 문서 시각으로 대체 — 병합에서 비교할 값이 반드시 있어야 한다
        at: (typeof v.at === "string" && v.at) ? v.at : updatedAt
      };
    }
  }
  return { notes, removedNotes, tags, removedTags, updatedAt,
           epoch: Number.isInteger(d.epoch) && d.epoch >= 0 ? d.epoch : 0 };
}

/** 메모 쪽 save(). 동기화 타이머는 코어와 공유한다 — syncNow 가 두 문서를 함께 처리한다 */
function saveNotes() {
  noteDoc.updatedAt = new Date().toISOString();
  writeNotesLocal();
  scheduleSync();
}

function writeNotesLocal() {
  try {
    localStorage.setItem(NOTES_KEY, JSON.stringify(noteDoc));
  } catch (e) {
    // 출석과 문구를 구분한다 — 어느 쪽이 안 저장됐는지 알아야 대처할 수 있다
    toast("메모 저장 실패 — 저장 공간을 확인하세요");
  }
}

/**
 * 메모 문서 병합 — 날짜의 생사는 툼스톤으로, 본문은 항목의 at 으로 가린다.
 * pickByStamp · newerEpoch 는 코어 병합과 공유하므로 app.js 에 있다.
 */
function mergeNotes(a, b) {
  if (a.epoch !== b.epoch) return newerEpoch(a, b);

  const r = pickByStamp(a, b, s => Object.keys(s.notes), s => s.removedNotes,
                        (s, d) => s.notes[d].at || s.updatedAt || "");

  /*
   * 살아남은 날짜의 "내용"은 at 이 늦은 쪽. 승급 이력이 쓰는 Map(뒤에 넣은 쪽이 이김)을
   * 그대로 쓰면 안 된다 — 이력은 날짜가 곧 사실이라 양쪽 내용이 같지만, 메모는 본문이 다르다.
   */
  const byDate = new Map();
  for (const s of [a, b]) {
    for (const [d, n] of Object.entries(s.notes)) {
      const cur = byDate.get(d);
      if (!cur || (n.at || "") > (cur.at || "")) byDate.set(d, n);
    }
  }

  /*
   * 분류도 같은 툼스톤 규칙. 합집합만 쓰면 한쪽에서 지운 분류가 되살아난다 (출석과 같은 함정).
   * 순서는 a 를 먼저 두고 b 에만 있는 것을 뒤에 붙여, 쓰던 기기의 배열이 흔들리지 않게 한다.
   *
   * "만든 시각"은 문서의 updatedAt 이 아니라 **항목의 at** 이다. 문서 시각을 쓰면 그 기기가
   * 메모 하나만 고쳐도 지워진 분류가 전부 되살아난다 (출석에서 똑같이 밟은 함정).
   */
  const tagIndex = new Map();
  const tagOf = s => {
    let m = tagIndex.get(s);
    if (!m) { m = new Map(s.tags.map(t => [t.id, t])); tagIndex.set(s, m); }
    return m;
  };
  const tg = pickByStamp(a, b, s => s.tags.map(t => t.id), s => s.removedTags,
                         (s, id) => (tagOf(s).get(id) || {}).at || s.updatedAt || "");
  const keptTags = new Set(tg.kept);
  const nameOf = new Map();
  for (const s of [a, b]) {
    for (const t of s.tags) {
      const at = t.at || s.updatedAt || "";
      const cur = nameOf.get(t.id);
      if (!cur || at > cur.at) nameOf.set(t.id, { name: t.name, at });
    }
  }
  let tags = [...new Set([...a.tags.map(t => t.id), ...b.tags.map(t => t.id)])]
    .filter(id => keptTags.has(id))
    .slice(0, MAX_TAGS)                     // 양쪽에서 더했다면 상한을 넘을 수 있다
    .map(id => withAt({ id, name: nameOf.get(id).name }, tg.stamps[id] || nameOf.get(id).at));
  if (!tags.length) tags = DEFAULT_TAGS.map(t => withAt({ ...t }, a.updatedAt || b.updatedAt));

  // 분류가 사라진 메모는 첫 분류로. 여기서 안 맞추면 필터에 걸리지 않는 유령 메모가 남는다
  const tagSet = new Set(tags.map(t => t.id));
  const notes = {};
  for (const d of r.kept) {
    const n = byDate.get(d);
    notes[d] = tagSet.has(n.tag) ? n : { ...n, tag: tags[0].id };
  }

  return {
    notes,
    removedNotes: r.tombs,
    tags,
    removedTags: tg.tombs,
    updatedAt: (b.updatedAt || "") > (a.updatedAt || "") ? b.updatedAt : a.updatedAt,
    epoch: a.epoch
  };
}

/** 메모 파일을 올릴지 판정. 새 필드를 여기 빠뜨리면 고쳐도 Gist 에 안 올라간다 */
function sameNotes(a, b) {
  const norm = s => JSON.stringify([s.epoch, s.notes, s.removedNotes, s.tags, s.removedTags]);
  return norm(a) === norm(b);
}

/* ============================================================
   메모 — 출석과 별개로 그날 있었던 일을 적는다.
   세미나·대회는 도장에 안 간 날일 수 있고 영상은 매트를 밟지 않고 본다.
   그래서 메모를 써도 출석이 켜지지 않고, 출석을 취소해도 메모는 남는다.
   ============================================================ */

const MONTH_PAGE = 3;                         // 달력 카드에 기본으로 보일 개수

let noteForm = { date: "", tag: "", orig: "" };   // orig = 열었을 때의 본문
let noteMode = "edit";                        // "view" | "edit" — 팝업이 무엇을 보여주는지
let tagEdit = false;                          // 분류 편집 모드 (편집 모드 안)
let monthLimit = MONTH_PAGE;                  // 달력 카드 목록 — 달을 바꾸면 리셋
let noteFilter = "all";                       // 「전체 메모」 상태 — 화면일 뿐 저장하지 않는다
let noteQuery = "";
let jumpYear = null;                          // 점프바에서 펼친 연도. null 이면 접힘

/**
 * 메모 팝업을 연다.
 * mode 를 주지 않으면 그 날짜에 메모가 있는지로 정한다 — 있으면 읽는 게 먼저다.
 */
function openNote(dateKey, mode) {
  const k = DATE_RE.test(dateKey || "") ? dateKey : key(today());
  tagEdit = false;                            // 분류 편집 상태를 물고 들어가지 않는다
  noteMode = mode || (noteDoc.notes[k] ? "view" : "edit");
  loadNoteForm(k);
  $("noteBack").hidden = false;
  $("noteBox").hidden = false;
  openOverlay("note", hideNote, $("noteBox"));
  // 보기 모드에서 focus 하면 모바일에서 읽으려 열 때마다 키보드가 올라온다
  if (noteMode === "edit") $("noteText").focus();
}

/** 보기 → 편집. 본문은 이미 폼에 실려 있으므로 다시 그리기만 하면 된다 */
function editNote() {
  noteMode = "edit";
  renderNoteForm();
  $("noteText").focus();
}

function hideNote() {
  $("noteBox").hidden = true;
  $("noteBack").hidden = true;
}

const closeNote = () => dismissOverlay("note");

/** 그 날짜의 기존 메모를 폼에 싣는다. 없으면 빈 폼 */
function loadNoteForm(k) {
  const rec = noteDoc.notes[k];
  noteForm = { date: k, tag: rec && hasTag(rec.tag) ? rec.tag : fallbackTag(),
               orig: rec ? rec.text : "" };
  $("noteDate").value = k;
  $("noteText").value = rec ? rec.text : "";
  $("btnNoteDelete").hidden = !rec;
  renderNoteForm();
}

/** 팝업 안의 파생 표시 — 제목 · 모드별 블록 · 분류 칩 · 글자 수 */
function renderNoteForm() {
  $("noteTitle").textContent = `메모 · ${fmtMD(parseKey(noteForm.date))}`;

  const view = noteMode === "view";
  $("noteView").hidden = !view;
  $("noteEdit").hidden = view;
  $("btnNoteEdit").hidden = !view;
  $("btnNoteSave").hidden = view;

  if (view) {
    $("noteViewTag").textContent = tagName(noteForm.tag);
    $("noteViewText").textContent = noteForm.orig;   // 사용자 입력 — textContent 로만
    return;                                          // 아래는 편집 폼 전용
  }

  $("btnTagEdit").textContent = tagEdit ? "완료" : "편집";

  const box = $("noteTags");
  box.innerHTML = "";
  noteDoc.tags.forEach(t => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-choice" + (!tagEdit && t.id === noteForm.tag ? " sel" : "")
                                 + (tagEdit ? " editing" : "");
    btn.textContent = t.name;
    if (tagEdit) {
      const x = document.createElement("i");
      x.className = "tag-x";
      x.textContent = "×";
      btn.appendChild(x);
      btn.setAttribute("aria-label", `${t.name} 분류 삭제`);
      btn.onclick = () => removeTag(t.id);
    } else {
      btn.onclick = () => { noteForm.tag = t.id; renderNoteForm(); };
    }
    box.appendChild(btn);
  });

  if (tagEdit) {
    const add = document.createElement("button");
    add.type = "button";
    add.className = "tag-choice tag-add";
    add.textContent = "＋ 분류";
    add.disabled = noteDoc.tags.length >= MAX_TAGS;
    add.onclick = addTag;
    box.appendChild(add);
  }

  $("noteCount").textContent = $("noteText").value.length;
}

function toggleTagEdit() {
  tagEdit = !tagEdit;
  renderNoteForm();
}

function addTag() {
  if (noteDoc.tags.length >= MAX_TAGS) { toast(`분류는 최대 ${MAX_TAGS}개입니다`); return; }
  const raw = prompt(`새 분류 이름 (${TAG_NAME_MAX}자 이내)`);
  if (raw === null) return;
  const name = raw.trim();
  if (!name) { toast("이름을 입력하세요"); return; }
  if (name.length > TAG_NAME_MAX) { toast(`${TAG_NAME_MAX}자 이내로 입력하세요`); return; }
  // 사용자가 만든 분류는 이름이 곧 id — 이름을 바꾸는 기능이 없어 둘을 나눌 이유가 없다
  if (noteDoc.tags.some(t => t.id === name || t.name === name)) {
    toast("이미 있는 분류입니다"); return;
  }
  noteDoc.tags.push({ id: name, name, at: new Date().toISOString() });
  delete noteDoc.removedTags[name];        // 지웠던 이름을 되살리면 삭제 표시를 지운다
  noteForm.tag = name;                     // 방금 만든 걸 바로 쓰고 싶을 것이다
  saveNotes();
  renderNoteForm();
  renderNotes();
  toast(`「${name}」 분류를 추가했습니다`);
}

function removeTag(id) {
  if (noteDoc.tags.length <= 1) { toast("분류는 하나 이상 있어야 합니다"); return; }

  const name = tagName(id);
  const used = Object.keys(noteDoc.notes).filter(k => noteDoc.notes[k].tag === id);
  const moveTo = noteDoc.tags.find(t => t.id !== id).id;
  const to = tagName(moveTo);
  const msg = used.length
    ? `「${name}」 분류를 삭제합니다.\n이 분류를 쓰는 메모 ${used.length}개는 ` +
      `「${to}」${toParticle(to)} 옮겨집니다.`
    : `「${name}」 분류를 삭제합니다.`;
  if (!confirm(msg)) return;

  noteDoc.tags = noteDoc.tags.filter(t => t.id !== id);
  // 툼스톤이 없으면 다른 기기와 동기화할 때 지운 분류가 되살아난다
  noteDoc.removedTags[id] = new Date().toISOString();
  // 옮긴 메모도 바뀐 것이므로 at 을 갱신해야 다른 기기로 전파된다
  const now = new Date().toISOString();
  used.forEach(k => { noteDoc.notes[k] = { ...noteDoc.notes[k], tag: moveTo, at: now }; });

  if (noteForm.tag === id) noteForm.tag = moveTo;
  if (noteFilter === id) noteFilter = "all";
  saveNotes();
  renderNoteForm();
  render();
  toast(used.length ? `삭제 · 메모 ${used.length}개를 옮겼습니다` : "분류를 삭제했습니다");
}

const noteDirty = () => $("noteText").value.trim() !== noteForm.orig;

/** 날짜를 옮길 때 — 안 물으면 날짜 하나 잘못 눌러 방금 쓴 글이 조용히 사라진다 */
function changeNoteDate(next) {
  if (!DATE_RE.test(next) || next === noteForm.date) { $("noteDate").value = noteForm.date; return; }
  if (noteDirty() && !confirm("저장하지 않은 내용이 있습니다. 버리고 다른 날짜로 옮길까요?")) {
    $("noteDate").value = noteForm.date;
    return;
  }
  loadNoteForm(next);
}

function saveNote() {
  const k = noteForm.date;
  const text = clip($("noteText").value.trim(), NOTE_MAX);
  if (!DATE_RE.test(k)) { toast("날짜를 선택하세요"); return; }
  if (!text) { toast("내용을 입력하세요"); return; }

  noteDoc.notes[k] = { text, tag: noteForm.tag, at: new Date().toISOString() };
  delete noteDoc.removedNotes[k];             // 다시 쓰면 삭제 표시를 지운다
  saveNotes();
  closeNote();
  render();
  toast(`${fmtShort(k)} 메모 저장`);
}

function deleteNote() {
  const k = noteForm.date;
  if (!noteDoc.notes[k]) return;
  if (!confirm(`${k} 메모를 삭제합니다.`)) return;
  delete noteDoc.notes[k];
  // 툼스톤이 없으면 다른 기기와 동기화할 때 지운 메모가 되살아난다
  noteDoc.removedNotes[k] = new Date().toISOString();
  saveNotes();
  closeNote();
  render();
  toast("메모를 삭제했습니다");
}

/**
 * 날짜 목록 (최신순).
 * ym 을 주면 그 달("2026-08")만, 안 주면 전체에 분류·검색어를 적용한다.
 */
function filteredNotes(ym) {
  const keys = Object.keys(noteDoc.notes).sort((a, b) => b.localeCompare(a));
  if (ym) return keys.filter(k => k.startsWith(ym));

  const q = noteQuery.trim().toLowerCase();
  return keys
    .filter(k => noteFilter === "all" || noteDoc.notes[k].tag === noteFilter)
    .filter(k => !q || k.includes(q) || noteDoc.notes[k].text.toLowerCase().includes(q));
}

/** 목록 항목 하나. 누르면 그 날짜의 편집 팝업이 열린다 */
function noteItemEl(k) {
  const rec = noteDoc.notes[k];
  const item = document.createElement("button");
  item.type = "button";
  item.className = "note-item";
  item.onclick = () => openNote(k);

  const meta = document.createElement("span");
  meta.className = "note-meta";
  const dt = document.createElement("span");
  dt.className = "note-date";
  // 연·월은 그룹 머리글이 맡으므로 일 + 요일만. 요일은 「그 금요일 수업」 하고 기억을 맞출 때 쓴다
  dt.textContent = `${k.slice(8)}(${DOW[parseKey(k).getDay()]})`;
  const tg = document.createElement("span");
  tg.className = "note-tag";
  tg.textContent = tagName(rec.tag);
  meta.append(dt, tg);

  const body = document.createElement("span");
  body.className = "note-body";
  body.textContent = rec.text;              // 사용자 입력 — textContent 로만 넣는다

  item.append(meta, body);
  return item;
}

/* ------------------------------------------------------------
   달력 카드 안의 「이 달의 메모」
   달력 칸의 표식과 같은 것을 가리키므로, 월을 넘기면 함께 따라간다.
   ------------------------------------------------------------ */

function renderMonthNotes() {
  const ym = key(calCursor).slice(0, 7);
  const month = calCursor.getMonth() + 1;
  const hit = filteredNotes(ym);
  const total = Object.keys(noteDoc.notes).length;

  const list = $("monthNoteList");
  const more = $("monthNoteMore");
  const link = $("btnAllNotes");
  list.innerHTML = "";
  more.hidden = true;
  link.hidden = !total;

  if (!total) {
    // 메모가 아예 없을 때만 쓰는 법을 알린다 — 그러지 않으면 기능이 있는 줄 모른다.
    // 입구가 둘이므로 둘 다 알려야 한다 (달력을 길게 누르는 쪽은 발견되기 어렵다)
    $("mnTitle").innerHTML = "메모 — 위 <b>연필</b>, 또는 날짜를 <b>길게</b> 눌러 남겨보세요";
    return;
  }
  // 올해가 아니면 연도를 붙인다 — 달을 계속 넘기다 보면 어느 해를 보고 있는지 놓친다
  const label = calCursor.getFullYear() === today().getFullYear()
    ? `${month}월` : `${calCursor.getFullYear()}년 ${month}월`;
  $("mnTitle").textContent = hit.length ? `${label} 메모 ${hit.length}개` : `${label} 메모 없음`;
  if (!hit.length) return;

  hit.slice(0, monthLimit).forEach(k => list.appendChild(noteItemEl(k)));

  const rest = hit.length - monthLimit;
  more.hidden = rest <= 0;
  if (rest > 0) more.textContent = `${rest}개 더`;
}

/* ------------------------------------------------------------
   「전체 메모」 화면 — 분류 필터 · 검색 · 전체 목록

   모달이 아니라 본문을 갈아 끼우는 화면이다. 스크롤·검색으로 오래 머무는 곳이라
   겹침 스택에서 빼냈다. 덕분에 목록 높이를 고정할 이유(모달 가운데 정렬이라 결과 수에 따라
   위아래로 튀던 것)도 사라져 그냥 페이지처럼 흐른다.
   ------------------------------------------------------------ */

let mainScroll = 0;             // 화면을 나갈 때의 본문 스크롤 — 돌아오면 그 자리로

function openAllNotes() {
  if (allNotesOpen()) return;
  jumpYear = null;
  mainScroll = window.scrollY;
  $("mainView").hidden = true;
  $("notesPage").hidden = false;
  window.scrollTo(0, 0);
  renderAllNotes();
  /*
   * 뒤로가기로 나갈 수 있도록 오버레이 스택에 얹는다 (히스토리 한 칸).
   * 모달이 아니라 화면이므로 포커스를 가두지 않는다 — box 를 주지 않는 이유다.
   */
  openOverlay("notes", hideAllNotes);
}

function hideAllNotes() {
  $("notesPage").hidden = true;
  $("mainView").hidden = false;
  /*
   * 본문을 되살린 직후엔 문서 높이가 아직 갱신 전이라 scrollTo 가 0 으로 잘린다.
   * scrollHeight 를 읽어 리플로우를 강제한 뒤 옮긴다 (rAF 로 미루면 한 프레임 튄다).
   */
  void document.documentElement.scrollHeight;
  window.scrollTo(0, mainScroll);
}

const closeAllNotes = () => dismissOverlay("notes");
const allNotesOpen = () => !$("notesPage").hidden;

/**
 * 월 머리글이 붙을 높이를 알려 준다.
 * 헤더+점프바(.page-top)가 top:0 에 붙고 머리글은 그 아래여야 하는데, 연도를 펴고 접을 때마다
 * 점프바 높이가 변해 CSS 상수로 못 박을 수 없다.
 */
let stickRaf = 0;
function syncStickyOffset() {
  /*
   * 다음 프레임에 잰다. 목록이 3만 px 가 넘는데 렌더 직후 getBoundingClientRect 를 부르면
   * 동기 레이아웃이 강제돼 렌더가 1.5ms → 17ms 로 뛴다 (검색 한 글자마다 그 값을 문다).
   */
  if (stickRaf) return;
  stickRaf = requestAnimationFrame(() => {
    stickRaf = 0;
    const h = $("notesTop").getBoundingClientRect().height;
    document.documentElement.style.setProperty("--notes-stick", Math.round(h) + "px");

    /*
     * 마지막 그룹도 맨 위까지 올라올 수 있어야 한다. 아래에 남은 내용이 없으면 스크롤이
     * 거기서 멈춰, 가장 오래된 달을 눌렀을 때 머리글이 화면 중간에 걸린다.
     * 모자란 만큼만 여백을 준다 — 넉넉히 주면 바닥에 빈 공간이 남는다.
     */
    const list = $("noteList");
    const last = list.lastElementChild;
    list.style.paddingBottom = "0px";
    if (last && last.classList.contains("note-group")) {
      const need = window.innerHeight - h - last.getBoundingClientRect().height;
      if (need > 0) list.style.paddingBottom = Math.ceil(need) + "px";
    }
  });
}

/**
 * 그 달로 이동. 머리글이 .page-top 바로 아래에 오도록 그 높이만큼 뺀다.
 *
 * 반드시 **그룹 컨테이너**(.note-group)를 재야 한다. 머리글은 sticky 라 한 번 붙고 나면
 * getBoundingClientRect 가 실제 위치가 아니라 붙어 있는 위치를 돌려준다 — 그걸 쓰면
 * 이미 지나온 달로 되돌아갈 때 「목표 = 지금 위치」가 되어 꼼짝도 안 한다.
 * (offsetTop 도 마찬가지로 밀린 위치를 준다)
 *
 * smooth 를 쓰지 않는다 — 몇 년을 건너뛰면 수만 px 라 한참 흐르고, 점프는 순간이동이어야 한다.
 */
function jumpTo(ym) {
  const g = $("noteList").querySelector(`.note-group[data-ym="${ym}"]`);
  if (!g) return;
  const off = $("notesTop").getBoundingClientRect().height;
  window.scrollTo(0, window.scrollY + g.getBoundingClientRect().top - off);
  flashHead(g.querySelector(".note-mhead"));
}

/**
 * 도착한 머리글을 잠깐 밝힌다.
 * 점프가 순간이동이라 「눌렀다」는 신호가 스크롤 말고는 없다 — 어디에 닿았는지도 함께 알려준다.
 */
function flashHead(el) {
  $("noteList").querySelectorAll(".note-mhead.flash").forEach(x => x.classList.remove("flash"));
  if (!el) return;
  void el.offsetWidth;                    // 같은 애니메이션을 다시 태우려면 리플로우가 필요하다
  el.classList.add("flash");
}

/**
 * 날짜 패널 — 연도 줄과 그 해의 월 줄.
 * 목록은 filteredNotes 기준이라 분류·검색을 걸면 남은 기간만 남는다.
 */
function renderJump(hit) {
  const byYear = new Map();                   // "2026" → ["2026-08", "2026-07", …] 최신순
  for (const k of hit) {
    const y = k.slice(0, 4), ym = k.slice(0, 7);
    if (!byYear.has(y)) byYear.set(y, []);
    const arr = byYear.get(y);
    if (arr[arr.length - 1] !== ym) arr.push(ym);
  }

  const years = [...byYear.keys()];
  // 열 때마다 최신 해를 펼쳐 둔다 — 흔한 경우(올해 안에서 이동)가 두 번 탭이면 끝난다
  if (!jumpYear || !byYear.has(jumpYear)) jumpYear = years[0] || null;

  // 달이 하나뿐이면 건너뛸 데가 없다
  $("btnJump").hidden = byYear.size === 0 ||
    (years.length === 1 && byYear.get(years[0]).length < 2);

  const yRow = $("jumpYears");
  yRow.innerHTML = "";
  yRow.hidden = years.length < 2;             // 한 해뿐이면 연도 줄은 군더더기
  years.forEach(y => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jump-chip" + (y === jumpYear ? " sel" : "");
    btn.textContent = y;
    // 연도는 「어느 해」만 고른다. 이동은 월을 고를 때 한 번만
    btn.onclick = () => { jumpYear = y; renderJump(filteredNotes()); };
    yRow.appendChild(btn);
  });

  const mRow = $("jumpMonths");
  mRow.innerHTML = "";
  if (!jumpYear) return;
  byYear.get(jumpYear).forEach(ym => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "jump-chip mon";
    btn.textContent = Number(ym.slice(5)) + "월";
    btn.onclick = () => { closeJumpPanel(); jumpTo(ym); };
    mRow.appendChild(btn);
  });
}

const jumpPanelOpen = () => !$("jumpPanel").hidden;

function toggleJumpPanel() {
  jumpPanelOpen() ? closeJumpPanel() : openJumpPanel();
}

function openJumpPanel() {
  jumpYear = null;                            // 최신 해가 펼쳐진 상태로 시작
  renderJump(filteredNotes());
  $("jumpPanel").hidden = false;
  $("btnJump").setAttribute("aria-expanded", "true");
}

function closeJumpPanel() {
  $("jumpPanel").hidden = true;
  $("btnJump").setAttribute("aria-expanded", "false");
}

/** 「2026년 8월  3개」 머리글. 연도 경계 표시는 감싸는 .note-group 이 맡는다 */
function monthHeadEl(ym, count) {
  const h = document.createElement("div");
  h.className = "note-mhead";
  const t = document.createElement("span");
  t.textContent = `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;
  const n = document.createElement("span");
  n.className = "n";
  n.textContent = `${count}개`;
  h.append(t, n);
  return h;
}

function renderAllNotes() {
  const total = Object.keys(noteDoc.notes).length;
  $("allNotesTitle").textContent = `전체 메모 · ${total}개`;

  // 지워진 분류를 계속 걸러 두면 목록이 영영 비어 보인다
  if (noteFilter !== "all" && !hasTag(noteFilter)) noteFilter = "all";

  const chips = $("noteFilters");
  chips.innerHTML = "";
  [{ id: "all", name: "전체" }, ...noteDoc.tags].forEach(t => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tag-choice" + (t.id === noteFilter ? " sel" : "");
    btn.textContent = t.name;
    btn.onclick = () => { noteFilter = t.id; renderAllNotes(); };
    chips.appendChild(btn);
  });

  const hit = filteredNotes();
  renderJump(hit);

  const list = $("noteList");
  list.innerHTML = "";
  if (!hit.length) {
    list.innerHTML = `<div class="empty">${total ? "조건에 맞는 메모가 없습니다."
                                                 : "아직 메모가 없습니다."}</div>`;
    syncStickyOffset();
    return;
  }

  /*
   * 전부 그린다. 10년치 1,560개가 5.3ms 라 나눠 그릴 이유가 없다 —
   * 문제는 렌더가 아니라 페이지가 10만 px 로 길어지는 것이고, 그건 점프바가 푼다.
   */
  const count = new Map();
  hit.forEach(k => { const ym = k.slice(0, 7); count.set(ym, (count.get(ym) || 0) + 1); });

  /*
   * 달마다 컨테이너로 감싼다. 머리글을 목록에 그냥 늘어놓으면 sticky 가 전부 같은 위치에
   * 겹쳐 붙어 위치를 잴 수 없고(jumpTo 주석 참조), 지나간 머리글도 사라지지 않는다.
   */
  let cur = null, prevYear = null;
  for (const k of hit) {                      // hit 은 최신순이라 훑기만 하면 그룹도 최신순
    const ym = k.slice(0, 7);
    if (!cur || cur.dataset.ym !== ym) {
      const year = ym.slice(0, 4);
      cur = document.createElement("div");
      cur.className = "note-group" + (prevYear !== null && year !== prevYear ? " year-start" : "");
      cur.dataset.ym = ym;
      cur.appendChild(monthHeadEl(ym, count.get(ym)));
      list.appendChild(cur);
      prevYear = year;
    }
    cur.appendChild(noteItemEl(k));
  }
  syncStickyOffset();
}

/** 두 목록을 함께 갱신. 모달은 열려 있을 때만 그린다 */
function renderNotes() {
  renderMonthNotes();
  if (allNotesOpen()) renderAllNotes();
}

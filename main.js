"use strict";

/* ============================================================
   바인딩과 부팅 — 반드시 마지막에 로드된다.

   여기만 최상위에서 다른 파일의 값($)을 읽는다. 나머지 파일의 최상위 코드는 자기 안에서
   닫혀 있어 로드 순서에 걸리지 않는다.
   ============================================================ */

/* ============================================================
   이벤트 바인딩
   ============================================================ */

$("btnShare").onclick = () => openShare("summary");
$("btnShareSend").onclick = sendShare;
$("btnShareSave").onclick = () => { saveShare(); toast("이미지를 저장했습니다"); };
$("btnShareLink").onclick = copyShareLink;
$("btnShareClose").onclick = closeShare;
$("shareBack").onclick = closeShare;

// 연필은 언제나 새 메모라 곧장 편집 모드로 연다
$("btnNote").onclick = () => openNote(key(today()), "edit");
$("btnNotesNew").onclick = () => openNote(key(today()), "edit");
$("btnNoteEdit").onclick = editNote;
$("btnNoteSave").onclick = saveNote;
$("btnNoteDelete").onclick = deleteNote;
$("btnNoteClose").onclick = closeNote;
$("btnTagEdit").onclick = toggleTagEdit;
$("noteBack").onclick = closeNote;
$("noteDate").onchange = e => changeNoteDate(e.target.value);
$("noteText").oninput = () => { $("noteCount").textContent = $("noteText").value.length; };
$("monthNoteMore").onclick = () => { monthLimit += MONTH_PAGE; renderMonthNotes(); };

$("btnAllNotes").onclick = openAllNotes;
$("btnJump").onclick = toggleJumpPanel;
$("btnNotesBack").onclick = () => closeAllNotes();
// 폭이 바뀌면 점프바 칩이 다시 줄바꿈돼 높이가 달라진다 → 월 머리글이 붙을 위치도 갱신
addEventListener("resize", () => { if (allNotesOpen()) syncStickyOffset(); });

/*
 * 스크롤 복원을 브라우저에게 맡기지 않는다. 전체 메모를 나갈 때 history.back() 이
 * 자동 복원을 발동시켜, 우리가 옮겨 둔 본문 스크롤 위치를 0 으로 덮어쓴다.
 */
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

/*
 * 폰 뒤로가기. 위에 뜬 것부터 닫되, 전체 메모 화면이 아직 살아 있으면 히스토리를 다시 쌓는다.
 * 그러지 않으면 팝업만 닫으려고 누른 뒤로가기가 화면까지 함께 닫는다.
 */
const repushNotes = () => { if (allNotesOpen()) history.pushState({ notesPage: true }, ""); };
addEventListener("popstate", () => {
  if (!$("picker").hidden)  { closePicker(); repushNotes(); return; }
  if (!$("noteBox").hidden) { closeNote();   repushNotes(); return; }
  closeAllNotes(true);
});

/*
 * 검색은 한 글자마다 전체 본문을 훑는 유일한 선형 경로다. 상한(500자)을 채운 메모가
 * 1,500건이면 한 번에 13ms 로 한 프레임에 육박한다. 타이핑이 멈춘 뒤 한 번만 돈다.
 */
const SEARCH_DEBOUNCE = 150;
let searchTimer = null;
$("noteSearch").oninput = e => {
  const v = e.target.value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    noteQuery = v;
    renderAllNotes();
  }, SEARCH_DEBOUNCE);
};

$("setStarted").dataset.clearable = "1";        // 주짓수 시작일은 비울 수 있다
[$("setStarted"), $("histDate"), $("noteDate")].forEach(inp => { inp.onclick = () => openPicker(inp); });
$("picker").querySelectorAll("[data-nav]").forEach(b => {
  b.onclick = () => {
    pickerCursor = addMonths(new Date(pickerCursor.getFullYear(), pickerCursor.getMonth(), 1),
                             Number(b.dataset.nav));
    renderPicker();
  };
});
$("pickerToday").onclick = () => commitPicker(key(today()));
$("pickerClear").onclick = () => commitPicker("");
$("pickerClose").onclick = closePicker;
$("pickerBack").onclick = closePicker;
/*
 * 위에 뜬 것부터 닫는다. 전체 메모가 화면이 된 뒤로 겹침은 두 겹뿐이다 —
 * 메모 팝업(58/59) → 날짜 선택기(60/61). 마지막 Escape 는 전체 메모 화면을 나간다.
 */
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (!$("picker").hidden) closePicker();
  else if (!$("shareBox").hidden) closeShare();
  else if (!$("noteBox").hidden) closeNote();
  else if (jumpPanelOpen()) closeJumpPanel();     // 날짜 패널이 떠 있으면 그것부터
  else if (allNotesOpen()) closeAllNotes();
});

/*
 * 월 패널 바깥을 누르면 닫는다 — 떠 있는 패널이 목록을 가린 채 남지 않도록.
 *
 * 캡처 단계여야 한다. 버블 단계에서는 칩의 onclick 이 먼저 돌며 renderJump 가 칩을 다시 그려,
 * e.target 이 이미 DOM 에서 떨어져 나간 뒤다 — contains() 가 false 라 방금 연 패널을 즉시 닫는다.
 */
document.addEventListener("click", e => {
  if (jumpPanelOpen() && !$("notesTop").contains(e.target)) closeJumpPanel();
}, true);

// 달을 바꾸면 그 달 목록을 처음부터 — 접힌 상태를 물고 가지 않는다
function goMonth(delta) {
  calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + delta, 1);
  monthLimit = MONTH_PAGE;
  renderCalendar();
}
$("calPrev").onclick = () => goMonth(-1);
$("calNext").onclick = () => goMonth(1);

$("setStarted").onchange = e => {
  const v = e.target.value;
  if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { e.target.value = state.startedAt; return; }
  if (v && parseKey(v) > today()) {
    alert("주짓수 시작일은 오늘 이후일 수 없습니다.");
    e.target.value = state.startedAt;
    return;
  }
  state.startedAt = v;                       // 빈 값이면 미설정으로 되돌린다
  save(); render();
};

$("btnAddHist").onclick = () => toggleHistForm($("histForm").hidden);
$("histDate").onchange = renderHistEffect;
$("btnHistSave").onclick = recordPromotion;
$("btnHistCancel").onclick = () => toggleHistForm(false);

$("btnExport").onclick = exportData;
$("btnImport").onclick = () => $("fileImport").click();
$("fileImport").onchange = e => {
  const f = e.target.files[0];
  if (f) importData(f);
  e.target.value = "";
};
$("btnReset").onclick = resetAll;

$("btnConnect").onclick = () => {
  const t = $("syncToken").value.trim();
  if (!t) { toast("토큰을 붙여넣어 주세요"); return; }
  connectSync(t);
};
$("syncToken").onkeydown = e => { if (e.key === "Enter") $("btnConnect").click(); };
$("btnSyncNow").onclick = () => syncNow(true);
$("btnGistOpen").onclick = () =>
  window.open("https://gist.github.com/" + sync.gistId, "_blank", "noopener");
$("btnDisconnect").onclick = disconnectSync;

// 앱으로 돌아올 때: 날짜 기준을 갱신하고, 다른 기기의 변경을 가져온다
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  render();
  if (syncOn() && (!sync.lastSync || new Date() - new Date(sync.lastSync) > 60000)) {
    syncNow(false);
  }
});

/* ============================================================
   시작
   ============================================================ */

loadSync();
loadNotes();     // 메모 문서가 없으면 빈 문서 — 옛 사용자를 위한 마이그레이션은 필요 없다
if (!load()) {
  save();                                  // 첫 실행: 기본값 저장
  $("settings").open = true;               // 벨트/시작일부터 설정하도록 안내
}
render();
if (syncOn()) syncNow(false);              // 다른 기기에서 올린 기록 반영

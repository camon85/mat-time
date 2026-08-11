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
$("btnNotesBack").onclick = closeAllNotes;
// 폭이 바뀌면 점프바 칩이 다시 줄바꿈돼 높이가 달라진다 → 월 머리글이 붙을 위치도 갱신
addEventListener("resize", () => { if (allNotesOpen()) syncStickyOffset(); });

/*
 * 스크롤 복원을 브라우저에게 맡기지 않는다. 전체 메모를 나갈 때 history.back() 이
 * 자동 복원을 발동시켜, 우리가 옮겨 둔 본문 스크롤 위치를 0 으로 덮어쓴다.
 */
if ("scrollRestoration" in history) history.scrollRestoration = "manual";

/*
 * 폰 뒤로가기 — 뜬 것 하나만 닫는다.
 *
 * 어느 오버레이가 몇 칸째인지는 history.state 에 적혀 있다 (app.js 오버레이 스택 참조).
 * 예전에는 「전체 메모」만 히스토리를 쌓아서, 본문에서 연 메모·공유 카드는 뒤로가기가
 * **앱을 나가 버렸다.**
 */
addEventListener("popstate", () => {
  popOverlaysTo((history.state && history.state.mt) || 0);
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

/*
 * 날짜 필드는 readonly 라 클릭으로 선택기를 연다. **키보드에서도 열려야 한다** —
 * 예전엔 onclick 뿐이라 키보드·스위치 사용자는 시작일도 승급일도 넣을 수 없었다.
 */
$("setStarted").dataset.clearable = "1";        // 주짓수 시작일은 비울 수 있다
[$("setStarted"), $("histDate"), $("noteDate")].forEach(inp => {
  inp.onclick = () => openPicker(inp);
  inp.setAttribute("aria-haspopup", "dialog");
  inp.onkeydown = e => {
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      openPicker(inp);
    }
  };
});
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
 * Escape 는 맨 위에 뜬 것 하나만 닫는다. 날짜 패널은 히스토리를 쌓지 않는 부속이라
 * 오버레이 스택보다 먼저 본다.
 */
document.addEventListener("keydown", e => {
  if (e.key === "Tab") { trapTab(e); return; }
  if (e.key !== "Escape") return;
  if (jumpPanelOpen()) { closeJumpPanel(); return; }
  const top = topOverlay();
  if (top) dismissOverlay(top.name);
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

$("calPrev").onclick = () => goMonth(-1);
$("calNext").onclick = () => goMonth(1);

/*
 * 달력 칸 길게 누르기 → 그날 메모. 칸은 매 렌더마다 새로 만들어지므로 격자에 위임한다.
 * 로직은 app.js 에 있다 (click 억제 규칙이 달력 렌더와 짝을 이루기 때문).
 */
const cal = $("calGrid");
cal.addEventListener("pointerdown", longPressStart);
cal.addEventListener("pointermove", longPressMove);
cal.addEventListener("pointerup", longPressCancel);
cal.addEventListener("pointercancel", longPressCancel);
cal.addEventListener("pointerleave", longPressCancel);
cal.addEventListener("contextmenu", longPressMenu);
// 스크롤이 시작되면 누르고 있던 것도 취소한다 (pointermove 가 안 오는 관성 스크롤 대비)
addEventListener("scroll", longPressCancel, { passive: true });

// 잔디 칸 → 그 달로 달력 이동. 371칸에 각각 붙이지 않고 위임한다
$("heatGrid").addEventListener("click", e => {
  const cell = e.target.closest("i[data-d]");
  if (cell) goToMonth(cell.dataset.d);
});

$("setStarted").onchange = e => {
  const v = e.target.value;
  if (v && !DATE_RE.test(v)) { e.target.value = state.startedAt; return; }
  if (v && parseKey(v) > today()) {
    alert("주짓수 시작일은 오늘 이후일 수 없습니다.");
    e.target.value = state.startedAt;
    return;
  }
  state.startedAt = v;                       // 빈 값이면 미설정으로 되돌린다
  save(); render();
};

$("setTrack").onchange = e => setTracking(e.target.checked);

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
  scheduleMidnight();                        // 절전에서 깨면 타이머가 밀려 있을 수 있다
  if (syncOn() && (!sync.lastSync || new Date() - new Date(sync.lastSync) > 60000)) {
    syncNow(false);
  }
});

/* ============================================================
   시작
   ============================================================ */

const notesStatus = loadNotes();   // 메모 문서가 없으면 빈 문서 — 옛 사용자를 위한 마이그레이션은 필요 없다
const coreStatus = load();
if (coreStatus === "empty") {
  save();                                  // 첫 실행: 기본값 저장
  $("settings").open = true;               // 벨트/시작일부터 설정하도록 안내
}
render();
scheduleMidnight();
if (syncOn()) syncNow(false);              // 다른 기기에서 올린 기록 반영

/*
 * 읽지 못한 데이터가 있었으면 알린다. 원본은 지우지 않고 `<키>-corrupt` 로 옮겨 두었으므로
 * 개발자 도구에서 꺼낼 수 있다 — 조용히 빈 화면을 보여주면 사용자는 유실로 받아들인다.
 */
if (coreStatus === "corrupt" || notesStatus === "corrupt") {
  const what = coreStatus === "corrupt" && notesStatus === "corrupt" ? "출석 기록과 메모"
             : coreStatus === "corrupt" ? "출석 기록" : "메모";
  setTimeout(() => alert(
    `저장된 ${what}를 읽지 못했습니다.\n` +
    "덮어쓰지 않고 따로 보관해 두었습니다 (localStorage 의 «-corrupt» 키).\n" +
    "깃허브에 연결해 두셨다면 곧 원격 기록으로 채워집니다."), 300);
}

/*
 * 오프라인에서도 열리도록 앱 셸을 캐시한다. file:// 로 열어보는 개발 흐름에서는
 * 등록 자체가 막히므로 프로토콜을 먼저 본다.
 */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
  addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(e => console.warn("SW 등록 실패", e));
  });
}

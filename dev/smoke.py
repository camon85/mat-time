#!/usr/bin/env python3
"""브라우저에서만 확인할 수 있는 것들 — 제스처·히스토리·포커스.

    python3 dev/smoke.py            # http 로 서브 (서비스 워커까지 확인)
    python3 dev/smoke.py --file     # file:// 로도 동작하는지 확인

순수 함수는 `node --test "test/*.test.mjs"` 가 맡는다. 여기서는 그쪽이 못 보는 것만 본다:
탭/롱프레스 구분, 뒤로가기로 오버레이 닫기, 키보드로 날짜 선택기 열기, 잔디 → 달력 이동.

`pip install playwright && playwright install chromium` 이 필요하다.
"""
import argparse
import functools
import http.server
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 달력과 날짜 선택기가 .cal-grid 를 함께 쓴다. 선택기를 한 번 연 뒤로는 숨겨진 선택기 칸이
# 먼저 잡혀 "보이지 않는 요소" 로 실패하므로, 반드시 #calGrid 로 좁혀야 한다
TODAY_CELL = "#calGrid .day.today"

results = []


def check(name, ok, detail=""):
    results.append((name, ok, detail))
    print(f"{'✔' if ok else '✖'} {name}" + (f"  — {detail}" if detail and not ok else ""))


def serve():
    """포트를 OS 에 맡겨 고른다 — 고정 포트는 다른 것이 쓰고 있으면 그냥 실패한다."""
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


def fresh(page, url):
    """저장된 기록이 없는 상태로 시작한다."""
    page.goto(url)
    page.evaluate("localStorage.clear()")
    page.goto(url)
    page.wait_for_selector(TODAY_CELL)


def run(url, label):
    print(f"\n=== {label} ===")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 390, "height": 780}, has_touch=True)

        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        # 예기치 않은 시스템 대화상자를 잡아 둔다. 출석 취소는 토스트 방식이라 하나도 안 떠야 한다
        # (핸들러가 없으면 Playwright 가 조용히 자동 거부해 검사가 헛돈다)
        dialogs = []
        page.on("dialog", lambda d: (dialogs.append(d.message), d.accept()))

        fresh(page, url)
        check("콘솔 오류 없이 뜬다", not errors, "; ".join(errors[:2]))

        # --- 탭 = 출석 토글
        page.click(TODAY_CELL)
        on = page.eval_on_selector(TODAY_CELL, "el => el.classList.contains('on')")
        check("오늘 칸을 탭하면 출석이 켜진다", on)
        check("켤 때는 되돌리기 버튼이 없다", page.is_hidden("#toastAction"))

        # --- 취소는 토스트로 되돌릴 수 있다. 잘못 스쳐서 지워지면 나중에 알아채기 어렵다
        t0 = page.evaluate("() => new Date().toISOString()")
        page.click(TODAY_CELL)
        check("탭 한 번으로 취소된다 (확인창 없음)",
              page.eval_on_selector(TODAY_CELL, "el => !el.classList.contains('on')"))
        check("시스템 대화상자가 뜨지 않는다", not dialogs, "; ".join(dialogs[:2]))
        check("되돌리기 버튼이 함께 뜬다",
              page.is_visible("#toastAction") and page.inner_text("#toastAction") == "되돌리기")

        page.click("#toastAction")
        page.wait_for_timeout(150)
        check("되돌리면 출석이 살아난다",
              page.eval_on_selector(TODAY_CELL, "el => el.classList.contains('on')"))
        check("되돌리기 버튼은 한 번 쓰고 사라진다", page.is_hidden("#toastAction"))
        # 되돌린 뒤의 켠 시각은 **취소보다 늦어야** 한다. 원래 시각을 복원하면
        # 이미 올라간 취소 툼스톤이 다음 병합에서 이겨 되살린 출석이 도로 사라진다
        check("되돌리기가 켠 시각을 새로 찍는다",
              page.evaluate("t0 => state.checked[key(today())] > t0", t0),
              page.evaluate("() => state.checked[key(today())]"))
        page.click(TODAY_CELL)
        check("다시 탭하면 취소된다",
              page.eval_on_selector(TODAY_CELL, "el => !el.classList.contains('on')"))

        # --- 롱프레스 = 메모. 출석은 절대 건드리면 안 된다
        box = page.locator(TODAY_CELL).bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.wait_for_timeout(700)
        page.mouse.up()
        page.wait_for_timeout(150)
        check("길게 누르면 메모 팝업이 열린다", page.is_visible("#noteBox"))
        check("롱프레스가 출석을 토글하지 않는다",
              page.eval_on_selector(TODAY_CELL, "el => !el.classList.contains('on')"))

        # --- 뒤로가기로 팝업만 닫힌다 (본문에서 연 오버레이도)
        page.go_back()
        page.wait_for_timeout(150)
        check("뒤로가기가 메모 팝업을 닫는다", not page.is_visible("#noteBox"))
        check("뒤로가기가 앱을 나가지 않는다", page.is_visible("#mainView"))

        # --- 짧은 탭은 롱프레스 뒤에도 정상 동작
        page.click(TODAY_CELL)
        check("롱프레스 다음의 짧은 탭은 다시 출석 토글",
              page.eval_on_selector(TODAY_CELL, "el => el.classList.contains('on')"))
        page.click(TODAY_CELL)

        # --- 잔디 칸 → 달력 이동
        page.evaluate("""() => {
          const d = new Date(); d.setMonth(d.getMonth() - 3);
          calCursor = new Date();
          window.__target = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-15`;
        }""")
        moved = page.evaluate("""() => {
          const before = calMonth.textContent;
          const cell = document.querySelector(`#heatGrid i[data-d^="${__target.slice(0,7)}"]`);
          if (!cell) return { ok: false, why: '잔디에 그 달 칸이 없다' };
          cell.click();
          return { ok: calMonth.textContent !== before, label: calMonth.textContent };
        }""")
        check("잔디 칸을 누르면 달력이 그 달로 간다", moved.get("ok"), moved.get("why", ""))
        check("도착한 달력 카드가 표시된다",
              page.eval_on_selector("#calGrid", "el => el.closest('.card').classList.contains('flash')"))

        # --- 승급 추적은 기본 꺼짐. 켜고 끄는 동안 이력은 손상되지 않아야 한다
        page.evaluate("settings.open = true")
        check("기본값: 승급 진행도 카드가 없다", not page.is_visible("#goalCard"))
        check("기본값: 로드맵 카드가 없다", not page.is_visible("#roadCard"))
        check("기본값: 달력에 승급식 표시가 없다",
              page.eval_on_selector_all("#calGrid .day.ceremony", "els => els.length === 0")
              and not page.is_visible("#legCeremony"))
        check("기본값: 토글이 꺼져 있다", not page.is_checked("#setTrack"))

        # 승급 이력은 추적과 무관하게 기록된다
        page.evaluate("""() => {
          putHistory({ date: '2025-01-10', belt: 1, stripe: 0 });
          save(); render();
        }""")
        check("추적이 꺼져 있어도 승급 이력은 기록된다",
              page.eval_on_selector_all("#histList .item", "els => els.length === 1"))
        check("추적이 꺼져 있어도 벨트는 이력에서 나온다",
              page.evaluate("() => currentRank().belt === 1"))

        # 실제 checkbox 는 스위치 그림 뒤에 있으므로 사용자와 같은 경로(라벨)로 누른다
        page.click(".toggle .switch")
        page.wait_for_timeout(100)
        check("켜면 승급 진행도 카드가 나타난다", page.is_visible("#goalCard"))
        check("켜면 로드맵이 나타난다", page.is_visible("#roadCard"))
        check("켜면 달력에 승급식이 표시된다",
              page.eval_on_selector_all("#calGrid .day.ceremony", "els => els.length >= 1")
              and page.is_visible("#legCeremony"))

        page.click(".toggle .switch")
        page.wait_for_timeout(100)
        kept = page.evaluate("""() => ({
          hist: state.history.length,
          belt: currentRank().belt,
          att: state.attendance.length,
          track: state.trackPromotion
        })""")
        check("다시 끄면 카드가 사라진다", not page.is_visible("#goalCard"))
        check("껐을 때 승급 이력이 지워지지 않는다", kept["hist"] == 1 and kept["belt"] == 1)
        check("껐을 때 출석도 그대로다", kept["att"] >= 0 and kept["track"] is False)
        check("설정이 저장된다",
              page.evaluate("() => JSON.parse(localStorage['bjj-attendance']).trackPromotion === false"))

        # 스위치는 그림일 뿐이고 아래는 진짜 checkbox 여야 한다 — 키보드로 눌러 확인
        page.focus("#setTrack")
        page.keyboard.press(" ")
        page.wait_for_timeout(100)
        check("스페이스바로 토글된다", page.is_checked("#setTrack") and page.is_visible("#goalCard"))
        page.keyboard.press(" ")
        page.wait_for_timeout(100)

        # --- 키보드로 날짜 선택기 열기
        page.focus("#setStarted")
        page.keyboard.press("Enter")
        page.wait_for_timeout(100)
        check("키보드(Enter)로 날짜 선택기가 열린다", page.is_visible("#picker"))
        check("선택기 안으로 포커스가 들어간다",
              page.evaluate("() => picker.contains(document.activeElement)"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(150)
        check("Escape 로 닫힌다", not page.is_visible("#picker"))
        check("포커스가 열었던 자리로 돌아온다",
              page.evaluate("() => document.activeElement === setStarted"))

        # --- 겹쳐 뜬 것은 위에서부터 하나씩
        page.click("#btnNote")
        page.wait_for_timeout(100)
        page.click("#noteDate")
        page.wait_for_timeout(100)
        check("메모 위에 날짜 선택기가 겹쳐 뜬다",
              page.is_visible("#picker") and page.is_visible("#noteBox"))
        page.go_back()
        page.wait_for_timeout(150)
        check("뒤로가기 한 번은 선택기만 닫는다",
              not page.is_visible("#picker") and page.is_visible("#noteBox"))
        page.go_back()
        page.wait_for_timeout(150)
        check("한 번 더 누르면 메모가 닫힌다", not page.is_visible("#noteBox"))

        # --- 전체 메모 화면
        page.evaluate("""() => {
          noteDoc.notes['2024-05-05'] = { text: '옛 메모', tag: 'class', at: new Date().toISOString() };
          noteDoc.notes[key(today())] = { text: '오늘 메모', tag: 'class', at: new Date().toISOString() };
          saveNotes(); render();
        }""")
        page.click("#btnAllNotes")
        page.wait_for_timeout(150)
        check("전체 메모 화면이 열린다", page.is_visible("#notesPage"))
        check("연·월 그룹으로 묶인다",
              page.eval_on_selector_all(".note-group", "els => els.length >= 2"))
        page.go_back()
        page.wait_for_timeout(200)
        check("뒤로가기로 본문에 돌아온다",
              page.is_visible("#mainView") and not page.is_visible("#notesPage"))

        # --- 공유 카드도 오버레이다 (예전엔 뒤로가기가 앱을 나갔다)
        page.click("#btnShare")
        page.wait_for_selector("#sharePreview[src]", timeout=5000)
        check("공유 카드가 그려진다", page.is_visible("#shareBox"))
        page.go_back()
        page.wait_for_timeout(150)
        check("뒤로가기가 공유 카드를 닫는다",
              not page.is_visible("#shareBox") and page.is_visible("#mainView"))

        # --- 백업 왕복
        roundtrip = page.evaluate("""() => {
          const doc = JSON.parse(JSON.stringify(backupDoc()));
          return { why: validateBackup(doc), att: doc.attendance.length };
        }""")
        check("내보낸 백업이 자기 검증을 통과한다", roundtrip["why"] is None, str(roundtrip["why"]))

        # --- 옛 백업(항목별 시각이 없던 시절)도 그대로 복원된다
        legacy = page.evaluate("""() => validateBackup({
          startedAt: "2020-03-01",
          attendance: ["2026-08-01"], removed: {},
          history: [{ date: "2025-01-10", belt: 1, stripe: 0 }], removedHistory: {},
          updatedAt: "2026-08-01T00:00:00.000Z", epoch: 0
        })""")
        check("항목별 시각이 없는 옛 백업도 받아들인다", legacy is None, str(legacy))

        # 앞의 잔디 점프로 달력이 다른 달에 가 있다. 오늘 칸을 쓰려면 이번 달로 돌아온다
        page.evaluate("goToMonth(key(today()))")
        page.wait_for_timeout(100)

        # --- 출석을 취소해도 그날 메모는 남는다 (둘은 독립이다)
        if not page.eval_on_selector(TODAY_CELL, "el => el.classList.contains('on')"):
            page.click(TODAY_CELL)
        page.click(TODAY_CELL)
        check("출석을 취소해도 그날 메모는 남는다",
              page.evaluate("() => !!noteDoc.notes[key(today())]"))

        # --- 연타: 토글이 짝이 맞고 유령 도장이 남지 않아야 한다
        for _ in range(6):
            page.click(TODAY_CELL)
        st = page.evaluate("() => ({on: state.attendance.length, chk: Object.keys(state.checked).length})")
        check("짝수 번 탭하면 켠 시각도 함께 지워진다", st["chk"] == st["on"], str(st))

        # --- 저장 공간이 꽉 찼을 때: 죽지 말고 알려야 한다
        quota = page.evaluate("""() => {
          const real = localStorage.setItem.bind(localStorage);
          localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
          let threw = false;
          try { toggleDay(key(addDays(today(), -3))); } catch (e) { threw = true; }
          localStorage.setItem = real;
          return { threw, toast: $('toastMsg').textContent };
        }""")
        check("저장 실패가 앱을 죽이지 않는다", not quota["threw"], str(quota))
        # 실패 안내가 마지막에 남아야 한다 — 「출석 완료」로 덮이면 안 저장된 걸 성공으로 알린다
        check("저장 실패를 사용자에게 알린다", "저장 실패" in quota["toast"], quota["toast"])
        check("저장 실패 시 완료 안내를 덮어씌우지 않는다", "완료" not in quota["toast"], quota["toast"])

        note_quota = page.evaluate("""() => {
          const real = localStorage.setItem.bind(localStorage);
          localStorage.setItem = () => { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; };
          openNote(key(addDays(today(), -5)), 'edit');
          $('noteText').value = '저장 안 될 메모';
          saveNote();
          localStorage.setItem = real;
          return $('toastMsg').textContent;
        }""")
        check("메모 저장 실패도 성공 안내에 덮이지 않는다",
              "저장 실패" in note_quota, note_quota)

        check("전 과정에서 콘솔 오류가 없다", not errors, "; ".join(errors[:3]))
        browser.close()


def check_safe_area(url):
    """홈 화면에서 실행했을 때 상단이 상태바·노치에 가리지 않는지.

    iOS 는 black-translucent 라 내용이 상태바 아래까지 그려진다. 크롬의 안전영역
    에뮬레이션으로 아이폰 값을 넣어 같은 조건을 만든다.
    """
    INSET = 59
    print("\n=== 안전영역 (홈 화면 실행) ===")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 393, "height": 852})
        cdp = page.context.new_cdp_session(page)
        try:
            cdp.send("Emulation.setSafeAreaInsetsOverride",
                     {"insets": {"top": INSET, "bottom": 34}})
        except Exception as e:
            print(f"  (건너뜀 — 이 크로미움은 안전영역 에뮬레이션이 없다: {str(e)[:60]})")
            browser.close()
            return
        fresh(page, url)
        page.evaluate("""() => {
          for (const d of ['2024-03-05', '2025-06-11', '2026-01-20', '2026-08-02'])
            noteDoc.notes[d] = { text: d + ' 메모', tag: 'class', at: new Date().toISOString() };
          saveNotes(); render();
        }""")

        r = page.evaluate("""() => ({
          belt: Math.round(document.querySelector('header .belt-mount').getBoundingClientRect().top),
          strip: Math.round(parseFloat(getComputedStyle(document.body, '::before').height))
        })""")
        check("맨 위 벨트가 상태바에 가리지 않는다", r["belt"] >= INSET, str(r))
        check("상태바 자리에 앱 배경이 깔린다", r["strip"] == INSET, str(r))

        page.click("#btnAllNotes")
        page.wait_for_timeout(400)
        page.evaluate("window.scrollTo(0, 1200)")
        page.wait_for_timeout(200)
        r = page.evaluate("""() => {
          const stick = parseFloat(getComputedStyle(document.documentElement)
                                   .getPropertyValue('--notes-stick'));
          // 지금 고정 선에 걸쳐 있는 그룹 — 그 머리글이 붙어 있어야 할 자리다.
          // (이미 지나간 머리글은 위로 밀려나므로 세면 안 된다)
          const g = [...document.querySelectorAll('.note-group')].find(el => {
            const b = el.getBoundingClientRect();
            return b.top <= stick && b.bottom > stick;
          });
          const head = g && g.querySelector('.note-mhead').getBoundingClientRect();
          /*
           * 머리글은 고정 선에 붙되, 자기 그룹이 끝나면 그 끝에 밀려 위로 올라간다
           * (그게 「지나간 머리글이 다음 것에 밀려나는」 동작이다). 기대값은 둘 중 작은 쪽.
           */
          return {
            bar: Math.round(notesTop.getBoundingClientRect().top),
            stick: Math.round(stick),
            barBottom: Math.round(notesTop.getBoundingClientRect().bottom),
            head: head ? Math.round(head.top) : null,
            want: g ? Math.round(Math.min(stick, g.getBoundingClientRect().bottom - head.height)) : null
          };
        }""")
        check("스크롤해도 고정 바가 상태바 아래에 붙는다", r["bar"] == INSET, str(r))
        check("--notes-stick 이 안전영역을 포함한다", r["stick"] == r["barBottom"], str(r))
        check("월 머리글이 고정 바 바로 아래에 붙는다",
              r["head"] is not None and abs(r["head"] - r["want"]) <= 1, str(r))

        jumped = page.evaluate("""() => {
          jumpTo('2024-03');
          const g = document.querySelector('.note-group[data-ym="2024-03"]');
          const stick = parseFloat(getComputedStyle(document.documentElement)
                                   .getPropertyValue('--notes-stick'));
          return Math.abs(g.getBoundingClientRect().top - stick) <= 1;
        }""")
        check("연·월 점프가 안전영역만큼 어긋나지 않는다", jumped)
        browser.close()


def check_corrupt(url):
    """읽지 못한 데이터를 덮어쓰지 않고 옆으로 옮기는지 — 새로 부팅해야 확인된다."""
    print("\n=== 손상된 저장소 ===")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.goto(url)
        page.evaluate("""() => {
          localStorage.setItem('bjj-attendance', '{깨진 JSON');
          localStorage.setItem('bjj-notes', '{이것도');
        }""")
        page.add_init_script("window.alert = m => { window.__alerted = m; };")
        page.goto(url)
        page.wait_for_selector(TODAY_CELL)
        page.wait_for_timeout(600)
        r = page.evaluate("""() => ({
          core: localStorage['bjj-attendance-corrupt'],
          notes: localStorage['bjj-notes-corrupt'],
          alerted: window.__alerted || ''
        })""")
        check("손상된 출석 원본이 보존된다", r["core"] is not None and "깨진" in r["core"])
        check("손상된 메모 원본도 보존된다", r["notes"] is not None)
        check("사용자에게 알린다", "읽지 못했습니다" in r["alerted"], r["alerted"][:60])
        check("그래도 정상 부팅한다",
              page.eval_on_selector_all("#calGrid .day", "els => els.length === 42"))
        browser.close()


def check_offline(url):
    """서비스 워커가 앱 셸을 잡았는지 — 네트워크를 끊고 다시 열어 본다."""
    print("\n=== 오프라인 ===")
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 390, "height": 780})
        page = ctx.new_page()
        page.goto(url)
        page.wait_for_selector(TODAY_CELL)
        page.evaluate("navigator.serviceWorker.ready")
        page.wait_for_timeout(800)          # 앱 셸이 캐시에 들어갈 틈

        ctx.set_offline(True)
        page.goto(url)
        try:
            page.wait_for_selector(TODAY_CELL, timeout=5000)
            ok = True
        except Exception:
            ok = False
        check("네트워크가 끊겨도 앱이 열린다", ok)
        if ok:
            check("오프라인에서도 달력이 그려진다",
                  page.eval_on_selector_all("#calGrid .day", "els => els.length === 42"))
        ctx.set_offline(False)
        browser.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", action="store_true", help="file:// 로도 확인한다")
    args = ap.parse_args()

    httpd, url = serve()
    try:
        run(url, "http (서비스 워커 등록됨)")
        check_offline(url)
        check_safe_area(url)
        check_corrupt(url)
        if args.file:
            run((ROOT / "index.html").as_uri(), "file://")
    finally:
        httpd.shutdown()

    bad = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} 통과")
    if bad:
        print("실패: " + ", ".join(bad))
        sys.exit(1)


if __name__ == "__main__":
    main()

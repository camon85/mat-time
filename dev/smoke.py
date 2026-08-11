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
TODAY_CELL = ".cal-grid .day.today"

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

        fresh(page, url)
        check("콘솔 오류 없이 뜬다", not errors, "; ".join(errors[:2]))

        # --- 탭 = 출석 토글
        page.click(TODAY_CELL)
        on = page.eval_on_selector(TODAY_CELL, "el => el.classList.contains('on')")
        check("오늘 칸을 탭하면 출석이 켜진다", on)
        page.click(TODAY_CELL)
        off = page.eval_on_selector(TODAY_CELL, "el => !el.classList.contains('on')")
        check("다시 탭하면 취소된다", off)

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
              page.eval_on_selector_all(".cal-grid .day.ceremony", "els => els.length === 0")
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
              page.eval_on_selector_all(".cal-grid .day.ceremony", "els => els.length >= 1")
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

        check("전 과정에서 콘솔 오류가 없다", not errors, "; ".join(errors[:3]))
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
                  page.eval_on_selector_all(".cal-grid .day", "els => els.length === 42"))
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

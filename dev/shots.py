"""
README 용 스크린샷 생성기.

샘플 데이터를 복원한 상태로 앱을 띄워 docs/images/*.png 를 만든다.
날짜가 오늘 기준 상대라 시간이 지나면 화면 값이 밀리므로, 문서를 손볼 때 다시 돌리면 된다.

  python3 dev/shots.py

playwright 가 필요하다:  pip install playwright && playwright install chromium
"""
import json
import pathlib
import subprocess
import sys
import tempfile

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "images"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 430, 932                       # 아이폰 폭. 2배로 찍어 레티나에서도 또렷하게
SCALE = 2

# 연·월 그룹과 날짜 이동은 여러 해가 있어야 보이므로 3년치로 만든다
tmp = pathlib.Path(tempfile.mkdtemp()) / "sample.json"
subprocess.run([sys.executable, str(ROOT / "dev" / "gen-sample.py"),
                "--months", "36", "-o", str(tmp)], check=True, stdout=subprocess.DEVNULL)
print(f"샘플 {len(json.loads(tmp.read_text())['notes'])}개 메모로 생성")


def shot(pg, name, sel=None, vh=None):
    """
    요소를 주면 그 요소만, 아니면 뷰포트를 찍는다.
    page.screenshot(clip=…) 은 좌표가 뷰포트가 아니라 문서 기준이라 스크롤이 반영되지 않는다.
    """
    if vh:
        pg.set_viewport_size({"width": W, "height": vh})
        pg.wait_for_timeout(200)
    (pg.locator(sel) if sel else pg).screenshot(path=str(OUT / f"{name}.png"))
    if vh:
        pg.set_viewport_size({"width": W, "height": H})
        pg.wait_for_timeout(150)
    print(f"  → docs/images/{name}.png")


with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={"width": W, "height": H}, device_scale_factor=SCALE)
    pg.on("dialog", lambda d: d.accept())
    pg.goto((ROOT / "index.html").as_uri())

    # 설정 → 복원 으로 샘플을 넣는다 (앱의 실제 경로를 그대로 탄다)
    pg.evaluate("document.getElementById('settings').open=true")
    pg.set_input_files("#fileImport", str(tmp))
    pg.wait_for_timeout(900)
    pg.evaluate("document.getElementById('settings').open=false; window.scrollTo(0,0)")
    # 「복원 완료」 토스트가 목록을 가린다. 사라진 뒤에 찍는다
    pg.wait_for_selector("#toast:not(.show)", timeout=5000)
    pg.wait_for_timeout(300)

    # 1. 첫 화면 — 벨트 · 달력 · 이 달의 메모. 한 화면에 담기게 잠깐 키운다
    shot(pg, "main", vh=1080)

    # 2~4. 카드는 요소째로 — 스크롤 위치에 좌우되지 않고 여백도 깔끔하다
    shot(pg, "record",   ".card:has(#heatGrid)")
    shot(pg, "progress", ".card:has(#goalPct)")
    shot(pg, "roadmap",  ".card:has(#roadList)")

    # 5. 메모 보기 → 편집. 여러 줄짜리 긴 메모라야 보기 모드가 무엇을 하는지 보인다
    pg.evaluate("""() => {
      const k = Object.keys(noteDoc.notes)
        .sort((a, b) => noteDoc.notes[b].text.length - noteDoc.notes[a].text.length)[0];
      openNote(k, "view");
    }""")
    pg.wait_for_timeout(250)
    shot(pg, "note-view", "#noteBox")
    pg.click("#btnNoteEdit")
    pg.wait_for_timeout(250)
    shot(pg, "note-edit", "#noteBox")
    pg.click("#btnNoteClose")

    # 6. 전체 메모 — 연·월 그룹
    pg.click("#btnAllNotes")
    pg.wait_for_timeout(350)
    shot(pg, "notes-all")

    # 7. 날짜로 이동 패널
    pg.click("#btnJump")
    pg.wait_for_timeout(300)
    shot(pg, "notes-jump")
    pg.click("#btnNotesBack")
    pg.wait_for_timeout(300)

    # 8. 공유 카드
    pg.evaluate("window.scrollTo(0,0)")
    pg.click("#btnShare")
    pg.wait_for_selector("#sharePreview[src]")
    pg.wait_for_timeout(400)
    shot(pg, "share", "#shareBox")
    pg.click("#btnShareClose")
    pg.wait_for_timeout(250)

    # 9. 승급 추적 설정 — 기본이 꺼짐이라 "이런 게 있다"를 그림으로 알려야 한다.
    #    샘플은 켜진 상태이므로 켜진 모습으로 찍힌다.
    #    .sync-box 는 좌우 여백을 바깥 카드에서 받으므로, 요소만 찍으면 글자가 가장자리에 붙는다.
    #    카드가 주던 여백을 잠깐 흉내내 화면과 같은 모양으로 찍는다
    pg.evaluate("""() => {
      settings.open = true;
      const box = document.querySelector('.sync-box:has(#setTrack)');
      box.style.padding = '16px';
      box.style.borderTop = 'none';
    }""")
    pg.wait_for_timeout(250)
    shot(pg, "tracking", ".sync-box:has(#setTrack)")

    b.close()

total = sum(f.stat().st_size for f in OUT.glob("*.png"))
print(f"\n{len(list(OUT.glob('*.png')))}장 · 합계 {total/1024:.0f} KB")

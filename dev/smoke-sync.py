#!/usr/bin/env python3
"""동기화 검증 — GitHub API 를 가로채 오류·경계 응답을 만들어 본다.

    python3 dev/smoke-sync.py

`dev/smoke.py` 와 나눈 이유: 여기는 **가짜 GitHub 서버**가 필요하고, 확인하는 것도
UI 가 아니라 요청/응답의 흐름이다. 실제 계정·토큰 없이 아래를 재현한다.

- gist 가 100개를 넘는 계정에서 기존 gist 를 찾아내는가 (못 찾으면 새로 만들어 버린다)
- 겹쳐 부른 동기화가 하나로 합쳐지는가
- 바뀐 파일만 PATCH 하는가 (문서를 둘로 나눈 이유가 여기서 실현된다)
- 401/403/404/500/네트워크 끊김이 사람이 읽는 안내가 되는가
- 실패해도 로컬 기록이 멀쩡한가
- 1MB 초과(truncated) 응답을 raw_url 로 우회하는가
- 초기화가 원격 세대(epoch) 위로 올라가는가

`pip install playwright && playwright install chromium` 이 필요하다.
"""
import functools
import http.server
import json
import pathlib
import socketserver
import sys
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
TODAY_CELL = "#calGrid .day.today"
results = []


def check(name, ok, detail=""):
    results.append((name, ok))
    print(f"{'✔' if ok else '✖'} {name}" + (f"  — {detail}" if detail and not ok else ""))


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(ROOT))
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/index.html"


REMOTE_CORE = json.dumps({
    "attendance": ["2026-07-01"], "checked": {"2026-07-01": "2026-07-01T10:00:00.000Z"},
    "removed": {}, "history": [], "removedHistory": {},
    "updatedAt": "2026-07-01T10:00:00.000Z", "epoch": 0
})


class FakeGitHub:
    """api.github.com 을 가로챈다. 올라온 파일을 실제로 저장해야 «바뀐 것만 올린다»를 볼 수 있다."""

    def __init__(self, page):
        self.patches, self.gist_gets, self.pages, self.fail = [], 0, [], None
        self.files = {"bjj-attendance.json": {"content": REMOTE_CORE, "truncated": False}}
        page.route("https://api.github.com/**", self.handle)
        # truncated 응답이 가리키는 원본 주소
        page.route("https://gist.example/**", lambda r: r.fulfill(status=200, body=REMOTE_CORE))

    def handle(self, route):
        req = route.request
        if self.fail is not None:
            code, msg = self.fail
            if code == 0:
                return route.abort("failed")          # 네트워크 끊김
            return route.fulfill(status=code, content_type="application/json",
                                 body=json.dumps({"message": msg}))

        if "/gists?" in req.url:
            # per_page 에도 "page=" 가 들어 있으므로 "&page=" 로 잘라야 한다
            page_no = int(req.url.split("&page=")[1].split("&")[0]) if "&page=" in req.url else 1
            self.pages.append(page_no)
            # gist 가 많은 계정을 흉내낸다 — 우리 것은 3페이지째에 있다
            if page_no < 3:
                body = [{"id": f"other-{page_no}-{i}", "files": {"unrelated.txt": {}}} for i in range(100)]
            elif page_no == 3:
                body = [{"id": "MINE", "files": {"bjj-attendance.json": {}}}]
            else:
                body = []
            return route.fulfill(status=200, content_type="application/json", body=json.dumps(body))

        if req.method == "PATCH":
            body = json.loads(req.post_data)
            self.patches.append(body)
            for name, f in body.get("files", {}).items():
                self.files[name] = {"content": f["content"], "truncated": False}
            return route.fulfill(status=200, content_type="application/json",
                                 body=json.dumps({"id": "MINE", "files": self.files}))

        if req.method == "POST":
            return route.fulfill(status=201, content_type="application/json",
                                 body=json.dumps({"id": "NEW", "files": self.files}))

        self.gist_gets += 1
        return route.fulfill(status=200, content_type="application/json",
                             body=json.dumps({"id": "MINE", "files": self.files}))

    def patched_files(self):
        return [sorted(x["files"].keys()) for x in self.patches]


def main():
    httpd, url = serve()
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page(viewport={"width": 390, "height": 780})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            gh = FakeGitHub(page)

            page.goto(url); page.evaluate("localStorage.clear()"); page.goto(url)
            page.wait_for_selector(TODAY_CELL)
            page.evaluate("settings.open = true")

            print("\n=== 연결 ===")
            page.fill("#syncToken", "ghp_test")
            page.click("#btnConnect")
            page.wait_for_timeout(1200)
            check("gist 목록의 페이지를 넘겨 찾는다", gh.pages[:3] == [1, 2, 3], str(gh.pages))
            check("찾았으면 새로 만들지 않는다", page.evaluate("() => sync.gistId") == "MINE",
                  page.evaluate("() => sync.gistId"))
            check("원격 기록을 이어받는다", page.evaluate("() => state.attendance.includes('2026-07-01')"))

            print("\n=== 동시 호출 ===")
            gh.gist_gets = 0
            state = page.evaluate("""async () => {
              syncNow(true); syncNow(true); syncNow(true);
              await new Promise(r => setTimeout(r, 900));
              return { busy: syncBusy };
            }""")
            check("겹친 호출이 하나로 합쳐진다", gh.gist_gets <= 2, f"gist GET {gh.gist_gets}회")
            check("끝나면 가드가 풀린다", state["busy"] == 0, str(state))

            print("\n=== 바뀐 파일만 올린다 ===")
            gh.patches.clear()
            page.click(TODAY_CELL)
            page.wait_for_timeout(2200)
            check("출석만 바꾸면 코어 파일만", gh.patched_files() and
                  all(f == ["bjj-attendance.json"] for f in gh.patched_files()), str(gh.patched_files()))
            gh.patches.clear()
            page.evaluate("""() => {
              noteDoc.notes[key(today())] = { text: '메모', tag: 'class', at: new Date().toISOString() };
              saveNotes();
            }""")
            page.wait_for_timeout(2200)
            check("메모만 바꾸면 메모 파일만", gh.patched_files() and
                  all(f == ["bjj-notes.json"] for f in gh.patched_files()), str(gh.patched_files()))

            print("\n=== 오류 응답 ===")
            for code, expect in [(401, "토큰"), (403, "권한"), (404, "Gist"), (500, "깃허브 오류"), (0, "네트워크")]:
                gh.fail = (code, "boom")
                page.click("#btnSyncNow")
                page.wait_for_timeout(700)
                msg = page.eval_on_selector("#syncMsg", "e => e.textContent")
                label = code or "네트워크 끊김"
                check(f"{label} → 사람이 읽는 안내", expect in msg, msg)
                check(f"{label} 후에도 가드가 풀린다", page.evaluate("() => syncBusy") == 0)
            gh.fail = None
            kept = page.evaluate("() => ({att: state.attendance.length, notes: Object.keys(noteDoc.notes).length})")
            check("실패가 로컬 기록을 건드리지 않는다", kept["att"] >= 1 and kept["notes"] >= 1, str(kept))
            check("다시 동기화하면 회복된다",
                  page.evaluate("async () => { await syncNow(true); return syncStatus.kind === 'ok'; }"))

            print("\n=== 경계 응답 ===")
            gh.files = {"bjj-attendance.json":
                        {"content": "", "truncated": True, "raw_url": "https://gist.example/raw"}}
            check("1MB 초과면 raw_url 로 우회해 읽는다",
                  page.evaluate("""async () => {
                    await syncNow(true); return state.attendance.includes('2026-07-01');
                  }"""))
            gh.files = {"bjj-attendance.json": {"content": "{깨진", "truncated": False}}
            before = page.evaluate("() => state.attendance.length")
            page.evaluate("async () => { await syncNow(true); }")
            page.wait_for_timeout(300)
            check("원격이 깨져도 로컬을 지우지 않는다",
                  page.evaluate("() => state.attendance.length") >= before)

            print("\n=== 초기화와 세대 ===")
            gh.files = {"bjj-attendance.json": {"content": json.dumps({
                "attendance": [], "removed": {}, "history": [], "removedHistory": {},
                "updatedAt": "2026-07-01T10:00:00.000Z", "epoch": 7}), "truncated": False}}
            gh.patches.clear()
            page.evaluate("() => { window.__c = window.confirm; window.confirm = () => true; }")
            page.click("#btnReset")
            page.wait_for_timeout(1200)
            pushed = [json.loads(x["files"]["bjj-attendance.json"]["content"])["epoch"]
                      for x in gh.patches if "bjj-attendance.json" in x["files"]]
            check("원격 세대(7) 위로 올린다", bool(pushed) and max(pushed) > 7, str(pushed))
            check("로컬 세대도 함께 올라간다", page.evaluate("() => state.epoch") > 7,
                  str(page.evaluate("() => state.epoch")))

            print("\n=== 연결 해제 ===")
            page.click("#btnDisconnect")
            page.wait_for_timeout(300)
            page.evaluate("() => { window.confirm = window.__c; }")
            check("토큰이 저장소에서 지워진다", page.evaluate("() => !localStorage['bjj-attendance-sync']"))
            check("기록은 남는다", page.evaluate("() => !!localStorage['bjj-attendance']"))
            check("토큰은 백업 파일에 들어가지 않는다",
                  page.evaluate("() => !JSON.stringify(backupDoc()).includes('ghp_')"))

            check("전 과정에서 콘솔 오류가 없다", not errors, "; ".join(errors[:3]))
            browser.close()
    finally:
        httpd.shutdown()

    bad = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(bad)}/{len(results)} 통과")
    if bad:
        print("실패: " + ", ".join(bad))
        sys.exit(1)


if __name__ == "__main__":
    main()

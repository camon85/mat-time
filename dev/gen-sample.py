"""
Mat Time 로컬 테스트용 샘플 데이터 생성기.

앱의 「설정 → 복원」에 넣을 수 있는 백업 JSON 하나를 만든다.
날짜를 전부 오늘 기준 상대로 계산하므로, 언제 돌려도 그때 기준으로 그럴듯한 상태가 나온다.
시드가 고정이라 같은 날 돌리면 결과도 같다.

  python3 dev/gen-sample.py                  # dev/sample-data.json 갱신 (10개월치)
  python3 dev/gen-sample.py --months 36      # 3년치 — 연·월 그룹과 연도 점프를 보려면 필요
  python3 dev/gen-sample.py -o 다른경로.json

이 파일은 앱에 포함되지 않는다. 배포는 저장소 루트를 그대로 올리므로 dev/ 도 함께
올라가지만 index.html 이 참조하지 않아 동작에 영향이 없다.
"""
import argparse, calendar, json, pathlib, random
from datetime import date, timedelta

ap = argparse.ArgumentParser(description="Mat Time 샘플 백업 생성기")
ap.add_argument("-o", "--out", default=str(pathlib.Path(__file__).with_name("sample-data.json")))
ap.add_argument("--months", type=int, default=10,
                help="출석·메모를 만들 기간(개월). 기본 10. 여러 해에 걸친 화면을 보려면 36 이상")
args = ap.parse_args()

random.seed(20260807)                       # 돌릴 때마다 같은 결과
TODAY = date.today()
OUT = args.out
SPAN = max(1, args.months) * 30             # 기록 기간(일)

k = lambda d: d.isoformat()


def last_friday(y, m):
    """그 달의 마지막 금요일 — 앱의 승급식 규칙과 같다"""
    last = date(y, m, calendar.monthrange(y, m)[1])
    return last - timedelta(days=(last.weekday() - 4) % 7)


def months_before(n):
    """n개월 전이 속한 달의 승급식(마지막 금요일)"""
    total = TODAY.year * 12 + (TODAY.month - 1) - n
    return last_friday(total // 12, total % 12 + 1)


# ── 승급 이력 ──────────────────────────────────────────────
# 화이트 그랄 구간은 3~5개월, 블루 이후는 8~10개월. 도장 기준(3/30 · 7/90)보다
# 조금씩 느린 실제 페이스로 잡는다. 날짜는 전부 그 달의 승급식.
STEPS = [
    (83, 0, 1), (79, 0, 2), (74, 0, 3), (70, 0, 4),      # 화이트 1~4그랄
    (61, 1, 0), (53, 1, 1), (44, 1, 2), (36, 1, 3), (27, 1, 4),   # 블루
    (17, 2, 0), (8, 2, 1), (5, 2, 2),                    # 퍼플 — 현재 퍼플 2그랄
]
# at 은 "그 항목을 기록한 시각" — 병합에서 삭제 툼스톤과 겨루는 값이다 (data-format.md §7).
# 없어도 앱이 문서 시각으로 채우지만, 샘플은 현재 형식을 그대로 보여주는 편이 낫다.
history = [{"date": k(months_before(m)), "belt": b, "stripe": s,
            "at": k(months_before(m)) + "T12:00:00.000Z"} for m, b, s in STEPS]
history.sort(key=lambda h: h["date"])

# 주짓수 시작일 — 첫 그랄 4개월 전쯤
started = months_before(87) - timedelta(days=12)

# ── 출석 ──────────────────────────────────────────────────
# 기본 10개월. 잔디는 53주를 그리므로 그보다 짧으면 왼쪽 끝에 「기록 전」(untracked)
# 구간이 남아 그 렌더링도 눈으로 확인된다.
track_from = TODAY - timedelta(days=SPAN)
attendance = []
d = track_from
# 부상·휴가로 통째로 쉰 구간. 기간에 비례해 흩는다
GAPS = [(TODAY - timedelta(days=int(SPAN * f) + 16), TODAY - timedelta(days=int(SPAN * f)))
        for f in (0.85, 0.55, 0.18)]
while d <= TODAY:
    if any(a <= d <= b for a, b in GAPS):
        d += timedelta(days=1)
        continue
    # 월·수·금이 기본, 가끔 빠지고 가끔 토요일 오픈매트
    if d.weekday() in (0, 2, 4) and random.random() > 0.14:
        attendance.append(k(d))
    elif d.weekday() == 5 and random.random() > 0.72:
        attendance.append(k(d))
    d += timedelta(days=1)

# ── 분류 ──────────────────────────────────────────────────
TAG_AT = k(months_before(6)) + "T09:00:00.000Z"
tags = [
    {"id": "class",   "name": "수업",     "at": TAG_AT},
    {"id": "seminar", "name": "세미나",   "at": TAG_AT},
    {"id": "comp",    "name": "대회",     "at": TAG_AT},
    {"id": "video",   "name": "영상",     "at": TAG_AT},
    {"id": "etc",     "name": "기타",     "at": TAG_AT},
    {"id": "노기",     "name": "노기",     "at": TAG_AT},   # 사용자가 추가한 분류 (이름이 곧 id)
    {"id": "오픈매트",  "name": "오픈매트", "at": TAG_AT},
]

# ── 메모 ──────────────────────────────────────────────────
POOL = {
    "class": [
        "클로즈 가드 브레이크 → 니슬라이스 패스. 무릎을 상대 배에 먼저 얹어야 힘이 덜 든다",
        "데라히바 가드 진입 3종. 발목 훅 각도가 조금만 틀어져도 바로 털린다",
        "사이드 컨트롤 이스케이프 — 프레임 먼저, 새우는 그 다음. 순서 바꾸면 안 됨",
        "암바 디테일: 다리로 머리를 눌러야 상대가 못 일어난다. 오늘 세 번 다 놓침",
        "베림볼로 기초. 아직 회전 중에 방향을 잃는다",
        "하프가드 언더훅에서 스윕 두 가지. 상대 무게중심을 먼저 무너뜨릴 것",
        "스파이더 가드 그립 유지가 관건. 손가락 힘이 먼저 빠진다",
        "트라이앵글 셋업 — 각도를 45도 더 틀어야 잠긴다",
        "패스 방어할 때 무릎 방패를 너무 늦게 세운다는 지적 받음",
        "백 컨트롤 훅 유지. 상대가 돌아누울 때 같이 따라가는 연습",
        "터틀 포지션에서 백 테이크. 오늘 처음으로 성공했다",
        "가드 리텐션 드릴 20분. 다리가 죽는 줄",
    ],
    "seminar": [
        "히샤우 세미나 — 데라히바 가드 패스 3종.\n무릎 각도가 핵심이고 상대 힙을 먼저 죽여야 한다",
        "레그락 세미나. 힐훅 안전하게 걸고 푸는 법 위주로. 탭은 빨리",
        "관장님 특강 — 경기 운영과 어드밴티지 관리. 지고 있을 때 뭘 해야 하는지",
    ],
    "comp": [
        "지역 대회 · 2승 1패. 스탠딩이 여전히 문제. 테이크다운 연습 필요",
        "오픈 토너먼트 참가. 1회전 탈락했지만 상대가 결승 갔다. 나쁘지 않았음",
        "팀 대회 · 3승. 처음으로 서브미션으로 이겼다. 트라이앵글",
        "체급 올려서 출전. 힘 차이가 확실히 느껴진다. 기술로 풀어야 함",
    ],
    "video": [
        "다나허 크로스 초크 인스트럭셔널. 그립을 먼저 깊게 넣는 게 전부",
        "고든 라이언 경기 분석. 패스할 때 상체 압박을 절대 안 뺀다",
        "미야오 형제 베림볼로 영상. 회전 타이밍을 다시 봐야겠다",
        "유튜브에서 본 하프가드 시리즈. 언더훅 없이도 스윕 가능한 루트",
    ],
    "etc": [
        "혼자 깨달음: 프레임 먼저, 힘은 나중. 계속 반대로 하고 있었다",
        "체중 2kg 감량. 경기 체급 맞추려면 3kg 더",
        "손가락 테이핑 시작. 그립 많이 쓰는 날은 필수",
        "오늘은 컨디션이 별로라 드릴만 하고 스파링은 쉬었다",
        "1년 전 영상과 비교해보니 가드 리텐션이 확실히 늘었다",
    ],
    "노기": [
        "노기 클래스. 기가 없으니 그립이 안 잡혀서 완전히 다른 운동 같다",
        "노기 스파링. 땀 때문에 자꾸 미끄러진다. 컨트롤을 몸으로 해야 함",
        "레그락 방어 — 노기에서는 발을 빼는 타이밍이 훨씬 빠르다",
    ],
    "오픈매트": [
        "오픈매트 5라운드. 상위 벨트한테 계속 눌렸지만 버티는 시간은 늘었다",
        "오픈매트에서 다른 관 사람들과. 스타일이 완전히 달라서 재밌었다",
        "토요일 오픈매트. 가볍게 플로우롤만",
    ],
}

notes, used = {}, set()
pool = [(tag, txt) for tag, lst in POOL.items() for txt in lst]
random.shuffle(pool)

att = sorted(set(attendance))
this_month = [x for x in att if x[:7] == k(TODAY)[:7]]
prev_month = [x for x in att if x[:7] == k(TODAY - timedelta(days=TODAY.day))[:7]]


def put(dk, tag, txt):
    if dk in used:
        return False
    used.add(dk)
    notes[dk] = {"text": txt, "tag": tag,
                 "at": f"{dk}T{random.randint(20, 23):02d}:{random.randint(0, 59):02d}:00.000Z"}
    return True


# 이번 달·지난 달을 먼저 채운다. 안 그러면 달력 아래 목록이 비어 보여
# 첫 화면에서 메모 기능이 있는지도 모른다.
for days, n in ((this_month, 4), (prev_month, 3)):
    for dk in random.sample(days, min(n, len(days))):
        if pool:
            put(dk, *pool.pop())

# 나머지는 전 구간에 흩는다. 대회·영상·기타는 도장에 안 간 날에도 붙을 수 있다.
# 기간이 길면 글감이 모자라므로 풀을 다시 섞어 돌린다 — 몇 달 간격으로 같은 주제를
# 다시 적는 건 실제 수련 일지에서도 흔하다.
target = max(len(pool), int(SPAN / 30 * 3.5))
cycle = list(pool)
while len(notes) < target and cycle:
    if not pool:
        pool = list(cycle)
        random.shuffle(pool)
    tag, txt = pool.pop()
    for _ in range(40):
        dk = (k(TODAY - timedelta(days=random.randint(0, SPAN)))
              if tag in ("comp", "video", "etc") else random.choice(att))
        if put(dk, tag, txt):
            break
    else:
        break                                   # 빈 날짜를 못 찾으면 그만

doc = {
    "startedAt": k(started),
    # 샘플은 승급 추적을 켠 상태다 — README 스크린샷에 진행도·로드맵이 나와야 한다.
    # 기본값은 꺼짐이므로, 이 줄이 없으면 복원해도 두 카드가 보이지 않는다
    "trackPromotion": True,
    "trackPromotionAt": f"{k(TODAY)}T09:00:00.000Z",
    "attendance": sorted(attendance),
    # 켠 시각 — 날짜마다 하나씩. 이게 있어야 다른 기기의 취소가 되살아나지 않는다
    "checked": {d: d + "T12:00:00.000Z" for d in sorted(attendance)},
    "removed": {},
    "history": history,
    "removedHistory": {},
    "notes": dict(sorted(notes.items())),
    "removedNotes": {},
    "tags": tags,
    "removedTags": {},
    "updatedAt": f"{k(TODAY)}T09:00:00.000Z",
    "epoch": 0,
}

with open(OUT, "w") as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)

cur = history[-1]
BELTS = ["화이트", "블루", "퍼플", "브라운", "블랙"]
stage = [x for x in attendance if x > cur["date"]]
print(f"→ {OUT}")
print(f"   주짓수 시작   {doc['startedAt']}  ({(TODAY - started).days // 365}년 전)")
print(f"   현재 벨트     {BELTS[cur['belt']]} {cur['stripe']}그랄  (승급 {cur['date']})")
print(f"   출석          {len(attendance)}일  ({k(track_from)} 부터 기록)")
print(f"   현재 단계 출석 {len(stage)}일 / 90일")
print(f"   승급 이력     {len(history)}건")
print(f"   메모          {len(notes)}개 · 분류 {len(tags)}종")
print(f"   파일 크기     {len(json.dumps(doc, ensure_ascii=False)) / 1024:.1f} KB")

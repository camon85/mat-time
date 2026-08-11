#!/usr/bin/env python3
"""홈 화면·설치용 아이콘을 만든다. 결과는 icons/ 에 커밋되므로 앱에는 의존성이 없다.

    python3 dev/gen-icons.py

앱 화면의 벨트 그래픽(styles.css .belt-bar)을 그대로 옮긴다 — 받침 위에 흰 벨트,
오른쪽 42% 검은 팁, 그 위에 흰 그랄. 색은 styles.css :root 와 같은 값이다.

안티에일리어싱은 4배로 그린 뒤 줄여서 얻는다 (PIL 의 도형은 계단이 남는다).
"""
import argparse
import pathlib

from PIL import Image, ImageDraw

BG = (14, 17, 22)          # --bg      #0e1116
MOUNT = (59, 66, 80)       # --mount   #3b4250
BELT = (255, 255, 255)     # 화이트 벨트
TIP = (20, 22, 27)         # --tip     #14161b

SS = 4                     # 슈퍼샘플링 배수


def draw_belt(size, belt_w_ratio, stripes=4):
    """size 정사각 아이콘 한 장. belt_w_ratio 는 캔버스 폭 대비 벨트 폭."""
    s = size * SS
    img = Image.new("RGB", (s, s), BG)
    d = ImageDraw.Draw(img)

    bw = s * belt_w_ratio
    bh = bw * 0.30                     # 앱 벨트보다 두껍게 — 작은 크기에서 실선으로 뭉개진다
    x0, y0 = (s - bw) / 2, (s - bh) / 2

    # 받침 — 어두운 배경에서 흰 벨트와 블랙 벨트가 모두 떠 보이게 하는 중간 톤
    pad = bh * 0.18
    d.rounded_rectangle([x0 - pad, y0 - pad, x0 + bw + pad, y0 + bh + pad],
                        radius=(bh + pad * 2) * 0.28, fill=MOUNT)

    # 벨트 본체 + 오른쪽 검은 팁. 팁이 모서리를 넘지 않도록 잘라 낸 뒤 합친다
    r = bh * 0.22
    belt = Image.new("RGB", (int(bw), int(bh)), BELT)
    bd = ImageDraw.Draw(belt)
    tip_w = bw * 0.42
    bd.rectangle([bw - tip_w, 0, bw, bh], fill=TIP)

    sw = max(2 * SS, bw * 0.034)       # 그랄 두께
    gap = sw * 0.7
    inset = bh * 0.18
    sx = bw - bw * 0.05 - sw
    for _ in range(stripes):
        bd.rectangle([sx, inset, sx + sw, bh - inset], fill=BELT)
        sx -= sw + gap

    mask = Image.new("L", (int(bw), int(bh)), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, int(bw) - 1, int(bh) - 1], radius=r, fill=255)
    img.paste(belt, (int(x0), int(y0)), mask)

    return img.resize((size, size), Image.LANCZOS)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-o", "--out", default="icons", help="출력 폴더 (기본: icons)")
    args = ap.parse_args()

    out = pathlib.Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # 일반 아이콘 — 벨트가 폭의 72%.
    # 32px 에서는 그랄 넷이 한 덩어리로 뭉개져 벨트가 아니라 얼룩으로 보인다 → 둘만 그린다
    made = []
    for size in (32, 180, 192, 512):
        name = "favicon-32.png" if size == 32 else \
               "apple-touch-icon.png" if size == 180 else f"icon-{size}.png"
        draw_belt(size, 0.72, stripes=2 if size <= 32 else 4).save(out / name, optimize=True)
        made.append(name)

    # maskable — OS 가 원형·둥근사각으로 잘라내므로 안쪽 80%(안전 영역) 안에 담는다
    draw_belt(512, 0.55).save(out / "maskable-512.png", optimize=True)
    made.append("maskable-512.png")

    for n in made:
        print(f"{out / n}  ({(out / n).stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()

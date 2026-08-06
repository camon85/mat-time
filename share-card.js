"use strict";

/* ============================================================
   공유 카드 — 내 기록을 이미지 한 장으로

   app.js 다음에 로드되는 일반 스크립트. app.js 의 상태·헬퍼를 읽기만 하고
   반대 방향 의존은 없다. (모듈이 아닌 이유는 docs/implementation.md 참조)

   DOM 을 캡처하지 않고 캔버스에 처음부터 그린다 — 의존성을 넣지 않기 위해서.
   ============================================================ */

const CARD_W = 1080, CARD_H = 480, CARD_SCALE = 2;

// styles.css :root 와 같은 값
const C = {
  bg: "#0e1116", surface: "#171b22", surface2: "#1f242d", line: "#2a303b",
  text: "#e6e9ef", muted: "#8b93a3", accent: "#4ade80", warn: "#fbbf24",
  untracked: "#14171d", mount: "#3b4250", tip: "#14161b", tipBlack: "#b91c1c"
};

const FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Pretendard", ' +
             '"Segoe UI", Roboto, "Noto Sans KR", sans-serif';

const font = (size, weight) => `${weight || 400} ${size}px ${FONT}`;

// 카드 문구 — 바꾸고 싶으면 여기만 고치면 된다
const TAGLINE = "꾸준함이 벨트를 만든다";
function spanLine() {
  const from = parseKey(state.startedAt), t = today();
  if (from > t) return "곧 시작";                 // 시작일을 미래로 넣은 경우
  const d = daysBetween(from, t);
  if (d === 0) return "오늘 첫 수련";              // "0일째 땀 흘리는 중" 을 막는다
  return `${fmtSpan(state.startedAt)} 땀 흘리는 중`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** paintBelt() 의 DOM 구조를 그대로 캔버스로 — 받침 + 벨트 + 검은 팁 + 흰 그랄 */
function drawBelt(ctx, x, y, w, h, belt, stripe) {
  const pad = Math.round(h * 0.18);
  ctx.fillStyle = C.mount;
  roundRect(ctx, x - pad, y - pad, w + pad * 2, h + pad * 2, (h + pad * 2) * 0.28);
  ctx.fill();

  ctx.save();
  roundRect(ctx, x, y, w, h, h * 0.22);
  ctx.clip();

  ctx.fillStyle = BELTS[belt].css;
  ctx.fillRect(x, y, w, h);

  const isBlack = belt >= BLACK;
  const tipW = w * 0.42;
  ctx.fillStyle = isBlack ? C.tipBlack : C.tip;
  ctx.fillRect(x + w - tipW, y, tipW, h);

  if (!isBlack) {
    const sw = Math.max(2, w * 0.034), gap = sw * 0.7;
    const inset = h * 0.18;
    let sx = x + w - w * 0.05 - sw;
    for (let i = 0; i < stripe; i++) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(sx, y + inset, sw, h - inset * 2);
      sx -= sw + gap;
    }
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(0,0,0,.5)";
  ctx.lineWidth = 1;
  roundRect(ctx, x + .5, y + .5, w - 1, h - 1, h * 0.22);
  ctx.stroke();
}

/**
 * 공유 카드 한 장을 그려 PNG Blob 으로 돌려준다.
 * mode: "summary" (평소) | "promotion" (승급 직후)
 */
function drawShareCard(mode) {
  const cv = document.createElement("canvas");
  cv.width = CARD_W * CARD_SCALE;
  cv.height = CARD_H * CARD_SCALE;
  const ctx = cv.getContext("2d");
  ctx.scale(CARD_SCALE, CARD_SCALE);
  ctx.textBaseline = "alphabetic";

  const { belt, stripe, since } = currentRank();
  const PAD = 64;
  const cx = CARD_W / 2;

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.fillStyle = C.surface;
  roundRect(ctx, PAD / 2, PAD / 2, CARD_W - PAD, CARD_H - PAD, 28);
  ctx.fill();

  /*
   * 담는 것은 앱 사용 시작 시점과 무관하게 정확한 둘뿐이다 — 띠와 연차.
   * 출석·연속·잔디는 앱을 늦게 시작하면 실제 수련량과 어긋나 카드를 망친다.
   * 띠 이름도 쓰지 않는다. 주짓수 하는 사람은 띠만 보면 알고, 모르는 사람에겐 이름도 의미가 없다.
   */
  const beltW = 620, beltH = 100;
  const MOUNT = Math.round(beltH * 0.18);        // drawBelt 가 벨트 밖으로 그리는 받침 두께
  const promoLine = mode === "promotion";
  const yearLine = !!state.startedAt;
  const tagLine = !promoLine;                    // 승급 모드엔 이미 축하 문구가 있다

  /*
   * 줄 수에 따라 내용 높이가 달라지므로 바닥 줄 위 영역에 세로 중앙 정렬한다.
   * 받침(MOUNT)을 빼먹으면 글자가 띠에 달라붙는다.
   */
  const GAP = 48;
  const textH = (promoLine ? 44 : 0) + (yearLine ? 38 : 0) + (tagLine ? 34 : 0);
  const blockH = beltH + MOUNT * 2 + (textH ? GAP + textH : 0);
  const footY = CARD_H - PAD / 2 - 30;
  const zoneTop = PAD / 2 + 10, zoneBot = footY - 36;
  const top = zoneTop + Math.round((zoneBot - zoneTop - blockH) / 2);

  drawBelt(ctx, cx - beltW / 2, top + MOUNT, beltW, beltH, belt, stripe);

  let y = top + beltH + MOUNT * 2 + GAP;         // 첫 글자 baseline
  ctx.textAlign = "center";

  if (promoLine) {
    const prev = state.history[state.history.length - 2];
    const gap = prev ? daysBetween(parseKey(prev.date), parseKey(since)) : 0;
    ctx.fillStyle = C.accent;
    ctx.font = font(30, 700);
    ctx.fillText(gap > 0 ? `🎉 ${gap}일 만에 승급` : "🎉 승급", cx, y);
    y += 44;
  }
  if (yearLine) {
    ctx.fillStyle = promoLine ? C.muted : C.text;
    ctx.font = font(promoLine ? 26 : 32, 600);
    ctx.fillText(spanLine(), cx, y);
    y += 38;
  }
  if (tagLine) {
    ctx.fillStyle = C.muted;
    ctx.font = font(24, 500);
    ctx.fillText(TAGLINE, cx, y);
  }
  ctx.textAlign = "left";

  // 바닥: 앱 이름과 주소 (이미지만 돌아다녀도 유입 경로가 남는다)
  ctx.fillStyle = C.text;
  ctx.font = font(24, 800);
  ctx.fillText("Mat Time", PAD + 12, footY);
  ctx.fillStyle = C.muted;
  ctx.font = font(21, 500);
  ctx.textAlign = "right";
  ctx.fillText(SHARE_URL.replace(/^https?:\/\//, ""), CARD_W - PAD - 12, footY);
  ctx.textAlign = "left";

  return new Promise(resolve => cv.toBlob(resolve, "image/png"));
}

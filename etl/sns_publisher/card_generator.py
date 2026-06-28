"""
CAN SLIM 일일 TOP 종목 SNS 카드 — 미니멀 카드뉴스 스타일

캐러셀 형식 (인스타그램/쓰레드):
  Card 0 — 표지
  Card 1~5 — 종목 상세 (1장 = 1종목)
  caption_YYYYMMDD.txt — 캡션
"""
import os
from datetime import date, datetime
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
import psycopg2

SIZE = 1080
PAD  = 72

# ── 팔레트 (미니멀: 배경 거의 흰색 계열 다크) ────────────────────
BG      = (12, 14, 20)       # 거의 검정
CARD    = (20, 24, 34)       # 카드 배경
LINE    = (32, 38, 54)       # 구분선
ACC     = (99, 179, 237)     # 포인트 블루
GREEN   = (52, 211, 153)
YELLOW  = (251, 191, 36)
ORANGE  = (251, 146, 60)
RED     = (248, 113, 113)
PRI     = (245, 248, 255)    # 주 텍스트 (거의 흰색)
SEC     = (130, 145, 175)    # 보조 텍스트
DIM     = (58, 68, 92)       # 희미한 텍스트

RANK_C  = [GREEN, (110,231,183), YELLOW, ORANGE, RED]


# ── 폰트 ─────────────────────────────────────────────────────────
def F(size, bold=False):
    for p in [
        f"C:/Windows/Fonts/{'malgunbd' if bold else 'malgun'}.ttf",
        "C:/Windows/Fonts/malgun.ttf",
        f"/usr/share/fonts/truetype/nanum/NanumGothic{'Bold' if bold else ''}.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


# ── 유틸 ─────────────────────────────────────────────────────────
def col(v):
    if v is None: return DIM
    v = float(v)
    if v >= 80: return GREEN
    if v >= 60: return (110,231,183)
    if v >= 45: return YELLOW
    if v >= 30: return ORANGE
    return RED

def fmt(v):       return f"{float(v):.0f}" if v is not None else "—"
def pct(v, p=True):
    if v is None: return "—"
    v=float(v); s="+" if v>=0 and p else ""
    return f"{s}{v:.1f}%"
def price(v):     return f"{int(v):,}원" if v else "—"
def cap(v):
    if v is None: return "—"
    v=float(v)
    return f"{v:.1f}조" if v>=1 else f"{v*1000:.0f}억"
def buy(v):
    if v is None: return "—"
    v=int(v); s="+" if v>=0 else "-"; a=abs(v)
    if a>=1_000_000: return f"{s}{a/1_000_000:.1f}M"
    if a>=1_000:     return f"{s}{a//1_000}K"
    return f"{s}{a}"


# ── DB ────────────────────────────────────────────────────────────
def fetch(n=5):
    conn = psycopg2.connect(dbname="canslim", user="canslim_user",
                            password="1234", host="localhost")
    cur = conn.cursor()
    cur.execute("""
        SELECT i.ticker, i.name, i.sector, i.market,
               cs.composite_score, cs.c_score, cs.a_score, cs.n_score,
               cs.s_score, cs.l_score, cs.i_score, cs.m_score,
               cs.score_date,
               pd.close,
               CASE WHEN pd_prev.close>0
                    THEN (pd.close-pd_prev.close)/pd_prev.close*100 END AS cr,
               dm.market_cap_tril, dm.eps_qoq_yoy_pct, dm.eps_3yr_cagr,
               dm.rs_percentile, dm.inst_net_buy_10d, dm.foreign_net_buy_10d,
               dm.pct_from_52w_high, dm.eps_annual_consistency
        FROM canslim_scores cs
        JOIN (SELECT security_id,MAX(score_date) md FROM canslim_scores GROUP BY security_id) lat
          ON cs.security_id=lat.security_id AND cs.score_date=lat.md
        JOIN instruments i ON i.id=cs.security_id
        LEFT JOIN price_daily pd ON pd.security_id=cs.security_id AND pd.trade_date=cs.score_date
        LEFT JOIN LATERAL (
            SELECT close FROM price_daily
            WHERE security_id=cs.security_id AND trade_date<cs.score_date
            ORDER BY trade_date DESC LIMIT 1) pd_prev ON TRUE
        LEFT JOIN LATERAL (
            SELECT market_cap_tril,eps_qoq_yoy_pct,eps_3yr_cagr,
                   rs_percentile,inst_net_buy_10d,foreign_net_buy_10d,
                   pct_from_52w_high,eps_annual_consistency
            FROM derived_metrics
            WHERE security_id=cs.security_id AND as_of_date<=cs.score_date
            ORDER BY as_of_date DESC LIMIT 1) dm ON TRUE
        WHERE cs.composite_score IS NOT NULL
        ORDER BY cs.composite_score DESC LIMIT %s
    """, (n,))
    cols = ["ticker","name","sector","market","composite","c","a","n","s","l","i","m",
            "score_date","close","cr","cap","yoy","cagr","rs","inst","foreign","h52","consist"]
    rows = [{k:v for k,v in zip(cols,r)} for r in cur.fetchall()]
    conn.close()
    return rows


# ── 표지 카드 ─────────────────────────────────────────────────────
def cover(stocks, path):
    img  = Image.new("RGB", (SIZE,SIZE), BG)
    d    = ImageDraw.Draw(img)
    today = stocks[0]["score_date"]
    ds    = today.strftime("%Y.%m.%d") if hasattr(today,"strftime") else str(today)

    # 상단 포인트 라인
    d.rectangle([0,0,SIZE,6], fill=ACC)

    # 브랜드 + 날짜
    d.text((PAD, 48),  "CAN SLIM", font=F(38,True), fill=ACC)
    d.text((PAD, 100), "성장주 레이더", font=F(26), fill=SEC)
    dw = d.textlength(ds, font=F(26))
    d.text((SIZE-PAD-dw, 64), ds, font=F(26), fill=SEC)

    # 메인 카피
    d.text((PAD, 200), "오늘의", font=F(52), fill=SEC)
    d.text((PAD, 262), "TOP 5", font=F(148,True), fill=PRI)
    d.text((PAD, 420), "성장주", font=F(52), fill=SEC)

    # 구분선
    d.line([(PAD,510),(SIZE-PAD,510)], fill=LINE, width=2)

    # 종목 리스트
    for i, s in enumerate(stocks[:5]):
        y  = 534 + i*100
        rc = RANK_C[i]
        comp = float(s["composite"] or 0)

        # 순위 도트
        d.ellipse([PAD, y+16, PAD+16, y+32], fill=rc)

        # 종목명
        d.text((PAD+30, y+4), f"#{i+1}  {s['name']}", font=F(36,True), fill=PRI)

        # 섹터
        d.text((PAD+30, y+50), f"{s['ticker']}  ·  {s.get('sector') or ''}", font=F(20), fill=SEC)

        # 점수
        st  = f"{comp:.0f}점"
        sw  = d.textlength(st, font=F(36,True))
        d.text((SIZE-PAD-sw, y+4), st, font=F(36,True), fill=rc)

        if i < 4:
            d.line([(PAD+20, y+86),(SIZE-PAD, y+86)], fill=LINE, width=1)

    # 푸터
    d.line([(PAD, SIZE-50),(SIZE-PAD, SIZE-50)], fill=LINE, width=1)
    d.text((PAD, SIZE-38), "⚠ 투자 참고용  ·  손실 책임은 투자자에게 있습니다.", font=F(18), fill=DIM)

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    return path


# ── 종목 상세 카드 ────────────────────────────────────────────────
def detail(s, rank, path):
    img = Image.new("RGB", (SIZE,SIZE), BG)
    d   = ImageDraw.Draw(img)
    rc  = RANK_C[min(rank-1, 4)]
    comp = float(s["composite"] or 0)
    ds   = s["score_date"].strftime("%Y.%m.%d") if hasattr(s["score_date"],"strftime") else str(s["score_date"])

    # 상단 포인트 라인 (순위 색)
    d.rectangle([0,0,SIZE,6], fill=rc)

    # ── 섹션 1: 헤더 (순위 + 종목명 + 점수) ──
    d.text((PAD, 42), f"#{rank}", font=F(52,True), fill=rc)
    rw = d.textlength(f"#{rank}", font=F(52,True))
    d.text((PAD+rw+20, 48), s["name"], font=F(52,True), fill=PRI)

    # 종합점수 — 우상단 크게
    st = fmt(comp)
    sw = d.textlength(st, font=F(96,True))
    d.text((SIZE-PAD-sw, 28), st, font=F(96,True), fill=col(comp))
    d.text((SIZE-PAD-54, 134), "점", font=F(28), fill=SEC)

    # 티커·마켓·섹터
    d.text((PAD, 112), f"{s['ticker']}  ·  {s['market']}  ·  {s.get('sector') or '—'}", font=F(24), fill=SEC)

    # ── 구분선 ──
    d.line([(PAD,162),(SIZE-PAD,162)], fill=LINE, width=1)

    # ── 섹션 2: 주가 정보 ──
    py = 180
    if s["close"]:
        cr    = float(s["cr"]) if s["cr"] is not None else None
        ptxt  = price(s["close"])
        d.text((PAD, py), ptxt, font=F(52,True), fill=PRI)
        if cr is not None:
            cr_c  = GREEN if cr>0 else RED if cr<0 else SEC
            cr_t  = pct(cr)
            pw    = d.textlength(ptxt, font=F(52,True))
            d.text((PAD+pw+16, py+10), cr_t, font=F(38,True), fill=cr_c)
    else:
        d.text((PAD, py), "—", font=F(52,True), fill=DIM)

    d.text((PAD, py+66), f"시총 {cap(s['cap'])}  ·  {ds}", font=F(24), fill=SEC)

    # ── 구분선 ──
    d.line([(PAD,268),(SIZE-PAD,268)], fill=LINE, width=1)

    # ── 섹션 3: 팩터 7개 ──
    # 2열 배치: 왼쪽 레이블, 오른쪽 점수+바
    FACTORS = [
        ("C", "분기 EPS 성장",  s["c"],  pct(s["yoy"])),
        ("A", "연간 성장성",     s["a"],  pct(s["cagr"],True)),
        ("N", "신고가 근접",     s["n"],  f"고점 대비 {pct(s['h52'])}"),
        ("S", "수급 강도",       s["s"],  f"기관 {buy(s['inst'])}  외인 {buy(s['foreign'])}"),
        ("L", "상대 강도",       s["l"],  f"RS {fmt(s['rs'])}위"),
        ("I", "기관 참여",       s["i"],  "기관 트렌드"),
        ("M", "시장 방향",       s["m"],  "시장 국면"),
    ]

    FY   = 285
    FH   = 80          # 팩터 행 높이
    BW   = 260         # 바 너비
    LX   = PAD         # 레이블 X
    BX   = SIZE-PAD-BW # 바 시작 X

    for i, (lbl, sub, score, detail_txt) in enumerate(FACTORS):
        fy  = FY + i * FH
        sc  = col(score)

        # 왼쪽: 팩터 알파벳 + 레이블
        d.text((LX, fy+4),  lbl, font=F(30,True), fill=sc)
        lw = d.textlength(lbl, font=F(30,True))
        d.text((LX+lw+14, fy+6),  sub, font=F(26,True), fill=PRI)
        d.text((LX+lw+14, fy+40), detail_txt, font=F(20), fill=SEC)

        # 오른쪽: 점수 숫자
        sv  = fmt(score)
        svw = d.textlength(sv, font=F(36,True))
        d.text((BX-svw-20, fy+8), sv, font=F(36,True), fill=sc)

        # 바
        BH = 8
        BY = fy + 56
        d.rounded_rectangle([BX, BY, BX+BW, BY+BH], radius=4, fill=LINE)
        if score:
            fw = max(8, int(BW * min(float(score),100)/100))
            d.rounded_rectangle([BX, BY, BX+fw, BY+BH], radius=4, fill=sc)

        # 행 구분선
        if i < 6:
            d.line([(PAD, fy+FH-2),(SIZE-PAD, fy+FH-2)], fill=LINE, width=1)

    # ── 섹션 4: 핵심 수치 3개 ──
    KY  = FY + 7*FH + 12
    d.line([(PAD,KY),(SIZE-PAD,KY)], fill=LINE, width=1)
    KY += 18

    kpis = [
        ("분기 EPS 성장률", pct(s["yoy"])),
        ("3년 연평균 성장", pct(s["cagr"],True)),
        ("RS 백분위",      f"{fmt(s['rs'])}위"),
    ]
    kw = (SIZE - PAD*2) // 3
    for i,(k,v) in enumerate(kpis):
        kx = PAD + i*kw
        d.text((kx, KY), k, font=F(20), fill=SEC)
        vc = SEC
        try:
            num = float(v.replace("%","").replace("+","").replace("위",""))
            vc  = GREEN if num>0 else RED if num<0 else PRI
        except Exception:
            vc = PRI
        d.text((kx, KY+28), v, font=F(32,True), fill=vc)

    # 푸터
    d.line([(PAD,SIZE-46),(SIZE-PAD,SIZE-46)], fill=LINE, width=1)
    d.text((PAD, SIZE-34), "⚠ 투자 참고용  ·  손실 책임은 투자자에게 있습니다.", font=F(17), fill=DIM)
    ht  = "#CANSLIM #성장주"
    htw = d.textlength(ht, font=F(17))
    d.text((SIZE-PAD-htw, SIZE-34), ht, font=F(17), fill=DIM)

    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    return path


# ── 캡션 ─────────────────────────────────────────────────────────
def caption(stocks):
    today = stocks[0]["score_date"]
    ds    = today.strftime("%Y년 %m월 %d일") if hasattr(today,"strftime") else str(today)
    medals = ["🥇","🥈","🥉","4️⃣","5️⃣"]
    lines = [f"📊 {ds} CAN SLIM 성장주 TOP 5","",
             "윌리엄 오닐의 7대 기준으로 선별한 오늘의 주도주입니다.",""]
    for i,s in enumerate(stocks[:5]):
        comp = float(s["composite"] or 0)
        cr   = float(s["cr"]) if s["cr"] else None
        crt  = f" ({pct(cr)})" if cr else ""
        lines.append(f"{medals[i]} {s['name']}({s['ticker']}){crt}  종합 {comp:.0f}점")
        lines.append(f"   C:{fmt(s['c'])} A:{fmt(s['a'])} N:{fmt(s['n'])} S:{fmt(s['s'])} L:{fmt(s['l'])} I:{fmt(s['i'])} M:{fmt(s['m'])}")
        lines.append("")
    lines += ["━━━━━━━━━━━━━━━━━━━━",
              "C 분기EPS  A 연간성장  N 신고가  S 수급  L 상대강도  I 기관  M 시장","",
              "⚠️ 투자 참고용. 손실 책임은 투자자 본인에게 있습니다.","",
              "#CANSLIM #성장주 #주식스크리너 #한국주식 #주식공부 #종목추천아님 #오닐투자법"]
    return "\n".join(lines)


# ── 진입점 ────────────────────────────────────────────────────────
def run(n=5, out_dir="output/sns"):
    stocks = fetch(n)
    if not stocks: raise RuntimeError("DB 조회 실패")
    ts  = datetime.now().strftime("%Y%m%d")
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)

    cover_p = out/f"cover_{ts}.png"
    cover(stocks, cover_p)

    details = []
    for rank, s in enumerate(stocks[:5], 1):
        p = out/f"detail_{ts}_{s['ticker']}.png"
        detail(s, rank, p)
        details.append(str(p))

    cap_p = out/f"caption_{ts}.txt"
    cap_p.write_text(caption(stocks), encoding="utf-8")

    return {"cover": str(cover_p), "details": details,
            "caption": str(cap_p), "stocks": stocks}


if __name__ == "__main__":
    r = run()
    print(f"표지:  {r['cover']}")
    for p in r["details"]: print(f"상세:  {p}")
    print(Path(r["caption"]).read_text(encoding="utf-8"))

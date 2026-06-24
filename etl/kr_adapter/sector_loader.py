"""
DART company API → instruments.sector 적재

DART의 induty_code(KSIC 한국표준산업분류)를 읽어 섹터명으로 매핑 후 저장.
실행: python -m etl.kr_adapter.sector_loader
"""

import logging
import time
import sys
import requests
from sqlalchemy import text
from ..shared.dart_client import download_corp_codes, _load_api_keys
from ..shared.db_writer import get_session

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# KSIC 3자리 코드 → 섹터명 (한국 증시 주요 업종)
KSIC_MAP: dict[str, str] = {
    # 음식/농업
    "101": "식품", "102": "식품", "103": "식품", "104": "식품", "105": "식품",
    "106": "식품", "107": "식품", "108": "식품", "109": "식품", "110": "음료",
    # 섬유/의류
    "131": "섬유", "132": "섬유", "139": "섬유", "141": "의류", "142": "의류",
    # 제지/목재
    "161": "목재", "171": "제지", "172": "제지",
    # 화학/정유
    "192": "정유", "201": "화학", "202": "화학", "203": "화학", "204": "화학",
    "205": "화학", "206": "화학", "207": "고무/플라스틱", "222": "고무/플라스틱",
    # 의약/바이오
    "211": "의약품", "212": "의약품",
    # 비금속/광물
    "231": "비금속광물", "232": "비금속광물", "239": "비금속광물",
    # 철강/금속
    "241": "철강", "242": "철강", "243": "비철금속", "244": "비철금속",
    "251": "금속가공", "259": "금속가공",
    # 기계
    "281": "일반기계", "282": "일반기계", "289": "일반기계",
    # 전기/전자
    "261": "전자부품", "262": "통신장비", "263": "통신장비",
    "264": "반도체", "265": "가전", "266": "전자부품",
    "271": "전기장비", "272": "전기장비", "273": "전기장비", "279": "전기장비",
    # 운송장비
    "301": "자동차", "302": "자동차부품", "311": "조선", "312": "조선",
    "313": "항공우주", "319": "기타운송",
    # 정밀기기
    "321": "의료기기", "322": "의료기기", "323": "광학기기",
    # 건설
    "410": "건설", "421": "건설", "422": "건설", "429": "건설",
    # 유통
    "451": "도매", "461": "도매", "471": "소매", "478": "소매",
    # 음식/숙박
    "551": "숙박", "561": "음식/외식", "562": "음식/외식",
    # IT/통신
    "581": "출판/미디어", "582": "게임", "591": "영상/미디어", "601": "방송",
    "612": "통신", "613": "통신", "620": "IT서비스", "631": "IT서비스",
    # 금융/보험
    "641": "은행", "642": "저축은행", "643": "신용카드",
    "649": "기타금융", "651": "보험", "652": "보험",
    "661": "증권", "662": "자산운용", "663": "기타금융",
    # 부동산
    "681": "부동산", "682": "부동산",
    # 전문서비스
    "701": "경영컨설팅", "711": "연구개발", "721": "건축설계",
    "731": "광고", "732": "광고",
    # 의료/복지
    "861": "병원", "869": "의료서비스", "871": "복지서비스",
    # 기타
    "960": "스포츠/레저",
}


def induty_to_sector(code: str) -> str:
    """KSIC 코드(2~4자리) → 섹터명. 3자리 기준 매핑, 없으면 상위 코드로 fallback."""
    c = str(code).strip()
    if c in KSIC_MAP:
        return KSIC_MAP[c]
    # 앞 3자리로 재시도
    if len(c) > 3 and c[:3] in KSIC_MAP:
        return KSIC_MAP[c[:3]]
    # 앞 2자리로 대분류 매핑
    prefix = c[:2]
    MAJOR = {
        "01": "농업", "02": "임업", "03": "어업", "05": "광업",
        "10": "식품", "11": "음료", "12": "담배", "13": "섬유",
        "14": "의류", "15": "가죽", "16": "목재", "17": "제지",
        "18": "인쇄", "19": "정유", "20": "화학", "21": "의약품",
        "22": "고무/플라스틱", "23": "비금속광물", "24": "철강/금속",
        "25": "금속가공", "26": "전자/반도체", "27": "전기장비",
        "28": "일반기계", "29": "자동차", "30": "기타운송",
        "31": "조선", "32": "의료기기", "33": "기타제조",
        "35": "전기/가스", "36": "수도", "37": "환경",
        "41": "건설", "42": "건설", "43": "건설",
        "45": "자동차판매", "46": "도매", "47": "소매", "48": "물류",
        "49": "물류", "50": "해운", "51": "항공", "52": "물류",
        "55": "숙박", "56": "음식", "58": "출판/미디어", "59": "영상/미디어",
        "60": "방송", "61": "통신", "62": "IT서비스", "63": "IT서비스",
        "64": "금융", "65": "보험", "66": "증권/금융",
        "68": "부동산", "69": "법률", "70": "전문서비스",
        "71": "연구개발", "72": "연구개발", "73": "광고",
        "74": "전문서비스", "75": "전문서비스", "76": "전문서비스",
        "81": "사업서비스", "82": "사업서비스", "84": "공공행정",
        "85": "교육", "86": "의료", "87": "사회복지",
        "90": "예술/문화", "91": "스포츠", "96": "서비스",
    }
    return MAJOR.get(prefix, f"기타({c})")


def load_sectors() -> None:
    logger.info("DART corp_code 목록 로드 중...")
    corp_map = download_corp_codes()   # {ticker: corp_code}
    api_keys = _load_api_keys()
    key_idx = 0

    # DB에서 전 종목 티커 목록
    with get_session() as sess:
        rows = sess.execute(text("SELECT id, ticker FROM instruments WHERE is_active = true")).fetchall()

    logger.info("총 %d 종목 섹터 조회 시작...", len(rows))

    updates: list[dict] = []
    errors = 0

    for i, (sid, ticker) in enumerate(rows):
        corp_code = corp_map.get(ticker)
        if not corp_code:
            continue

        key = api_keys[key_idx % len(api_keys)]
        try:
            r = requests.get(
                "https://opendart.fss.or.kr/api/company.json",
                params={"crtfc_key": key, "corp_code": corp_code},
                timeout=10,
            )
            data = r.json()
            induty_code = data.get("induty_code", "")
            if induty_code:
                sector = induty_to_sector(induty_code)
                updates.append({"id": sid, "sector": sector})
        except Exception as e:
            errors += 1
            logger.debug("조회 실패 [%s]: %s", ticker, e)

        key_idx += 1
        if (i + 1) % 100 == 0:
            logger.info("진행: %d/%d (updates=%d, errors=%d)", i + 1, len(rows), len(updates), errors)
        time.sleep(0.05)   # rate limit

    if not updates:
        logger.error("업데이트할 데이터가 없습니다.")
        sys.exit(1)

    logger.info("DB 업데이트 중: %d 종목...", len(updates))
    with get_session() as sess:
        for row in updates:
            sess.execute(
                text("UPDATE instruments SET sector = :sector WHERE id = :id"),
                row
            )

    logger.info("완료: %d 종목 섹터 적재", len(updates))


if __name__ == "__main__":
    load_sectors()

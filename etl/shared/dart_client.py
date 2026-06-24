"""
DART OpenAPI 클라이언트

주요 특징:
  - account_id 필드 없음 → account_nm 키워드 매칭으로 계정 추출
  - fs_div 파라미터 지정해도 CFS+OFS 모두 반환 → 호출당 양쪽 저장 가능
  - corp_code는 ZIP 다운로드 후 CSV 캐시 (etl/config/corp_codes.csv)

DART API 일일 한도: 10,000건/일 (무료 키 기준)
"""
import io
import csv
import time
import zipfile
import logging
import itertools
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Optional

import requests
import yaml

logger = logging.getLogger(__name__)

DART_BASE         = "https://opendart.fss.or.kr/api"


class DartDailyLimitError(Exception):
    """DART API 일일 호출 한도(10,000건) 초과."""


# ────────────────────────────────────────────────
# API 키 라운드로빈 관리
# ────────────────────────────────────────────────
_key_cycle: Optional[itertools.cycle] = None
_exhausted_keys: set[str] = set()


def _load_api_keys() -> list[str]:
    config_path = Path(__file__).parent.parent / "config" / "dart.yaml"
    with open(config_path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    # 하위 호환: api_key(단일) or api_keys(목록)
    if "api_keys" in cfg:
        keys = [k for k in cfg["api_keys"] if k and not k.startswith("#")]
    else:
        keys = [cfg["api_key"]]
    if not keys:
        raise ValueError("dart.yaml에 유효한 api_keys가 없습니다.")
    return keys


def _get_next_key() -> str:
    """소진된 키를 건너뛰고 다음 유효한 키 반환. 전부 소진 시 DartDailyLimitError."""
    global _key_cycle
    all_keys = _load_api_keys()
    if _key_cycle is None:
        _key_cycle = itertools.cycle(all_keys)

    for _ in range(len(all_keys)):
        key = next(_key_cycle)
        if key not in _exhausted_keys:
            return key

    raise DartDailyLimitError(f"모든 API 키({len(all_keys)}개) 일일 한도 초과")


def _mark_key_exhausted(api_key: str) -> None:
    _exhausted_keys.add(api_key)
    logger.warning("키 [%s...] 소진 처리 (총 %d/%d개 소진)",
                   api_key[:8], len(_exhausted_keys), len(_load_api_keys()))
_CORP_CODE_CACHE  = Path(__file__).parent.parent / "config" / "corp_codes.csv"


# ────────────────────────────────────────────────
# 계정명 키워드 (우선순위 순, 낮은 ord 항목 우선)
# ────────────────────────────────────────────────
_REVENUE_KW   = ["매출액", "영업수익", "수익(매출액)", "매출"]
_OPER_KW      = ["영업이익", "영업손익"]
_NET_KW       = ["당기순이익", "당기순손익"]
_EPS_KW       = ["기본주당순이익", "기본주당이익(손실)", "기본주당이익", "기본주당"]




def _parse_amount(s: str) -> Optional[float]:
    """DART 금액 문자열 파싱. 빈 값·'-'·공백 → None."""
    if not s or s.strip() in ("", "-"):
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def download_corp_codes(force: bool = False) -> dict[str, str]:
    """
    DART 전체 기업 corp_code 목록 다운로드 및 CSV 캐시.
    returns: {stock_code(6자리): corp_code(8자리)}
    """
    if _CORP_CODE_CACHE.exists() and not force:
        result = {}
        with open(_CORP_CODE_CACHE, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                sc = row["stock_code"].strip()
                if sc:
                    result[sc.zfill(6)] = row["corp_code"]
        logger.info("corp_code 캐시 로드: %d 상장 기업", len(result))
        return result

    api_key = _get_next_key()
    logger.info("DART corp_code 목록 다운로드 중...")
    resp = requests.get(f"{DART_BASE}/corpCode.xml",
                        params={"crtfc_key": api_key}, timeout=60)
    resp.raise_for_status()

    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        xml_content = zf.read(zf.namelist()[0])

    root = ET.fromstring(xml_content)
    rows, result = [], {}
    for item in root.findall(".//list"):
        corp_code  = item.findtext("corp_code", "").strip()
        corp_name  = item.findtext("corp_name",  "").strip()
        stock_code = item.findtext("stock_code", "").strip()
        rows.append({"corp_code": corp_code, "corp_name": corp_name, "stock_code": stock_code})
        if stock_code and len(stock_code) == 6:
            result[stock_code] = corp_code

    _CORP_CODE_CACHE.parent.mkdir(parents=True, exist_ok=True)
    with open(_CORP_CODE_CACHE, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["corp_code", "corp_name", "stock_code"])
        writer.writeheader()
        writer.writerows(rows)

    logger.info("corp_code 다운로드 완료: %d 상장 기업 (CSV 저장)", len(result))
    return result


def fetch_financial_statement(
    corp_code: str,
    bsns_year: int,
    reprt_code: str,
    delay_sec: float = 0.3,
) -> list[dict]:
    """
    단일 기업 재무제표 조회. CFS·OFS 모두 포함된 리스트 반환.

    reprt_code:
        11013: 1분기보고서  (Q1 누적)
        11012: 반기보고서   (Q2, 6개월 누적)
        11014: 3분기보고서  (Q3, 9개월 누적)
        11011: 사업보고서   (연간)

    빈 리스트 = 해당 보고서 없음(신규상장·미제출 등).
    """
    api_key = _get_next_key()
    try:
        resp = requests.get(
            f"{DART_BASE}/fnlttSinglAcnt.json",
            params={
                "crtfc_key":  api_key,
                "corp_code":  corp_code,
                "bsns_year":  str(bsns_year),
                "reprt_code": reprt_code,
            },
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        time.sleep(delay_sec)

        status = data.get("status")
        if status == "000":
            return data.get("list", [])
        if status == "013":   # 조회 데이터 없음 (정상)
            return []
        if status == "020":   # 일일 한도 초과
            logger.warning("키 [%s...] 한도 초과, 다음 키로 전환", api_key[:8])
            _mark_key_exhausted(api_key)   # 모든 키 소진 시 DartDailyLimitError 발생
            return fetch_financial_statement(corp_code, bsns_year, reprt_code, delay_sec)
        logger.warning("DART API 오류 [%s %s %s]: %s %s",
                       corp_code, bsns_year, reprt_code,
                       status, data.get("message", ""))
        return []

    except requests.RequestException as e:
        logger.warning("DART 요청 실패 [%s %s %s]: %s", corp_code, bsns_year, reprt_code, e)
        time.sleep(delay_sec)
        return []


def extract_is_accounts(items: list[dict], fs_div: str) -> dict:
    """
    재무제표 항목 리스트에서 IS(손익계산서) 계정 추출.

    fs_div: 'CFS'(연결) or 'OFS'(별도)
    returns: {revenue, operating_income, net_income, eps} — 없으면 None
    """
    # IS·CIS 항목만, 해당 fs_div만, ord 오름차순
    candidates = [
        x for x in items
        if x.get("sj_div") in ("IS", "CIS") and x.get("fs_div") == fs_div
    ]
    candidates.sort(key=lambda x: int(x.get("ord", 9999)))

    def find(keywords: list[str]) -> Optional[float]:
        for kw in keywords:
            for item in candidates:
                if kw in item.get("account_nm", ""):
                    return _parse_amount(item.get("thstrm_amount", ""))
        return None

    return {
        "revenue":          find(_REVENUE_KW),
        "operating_income": find(_OPER_KW),
        "net_income":       find(_NET_KW),
        "eps":              find(_EPS_KW),
    }

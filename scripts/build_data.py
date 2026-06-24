"""
警察庁「犯罪統計資料」(e-Stat) の都道府県別表（第6表：重要犯罪・重要窃盗犯）から
不審者に関連性が高い犯罪種別を抽出し、人口データと合わせて data/prefectures.json を生成する。

データソース:
  - 犯罪統計資料(暫定値): https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&lid=000001483773
    (生データを data/raw/crime_stats_r8_1-5.csv に Shift_JIS のまま保存済み)
  - 都道府県人口: 総務省統計局「令和2年国勢調査」

再生成する場合: python3 scripts/build_data.py
"""
import csv
import io
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW_CSV = ROOT / "data" / "raw" / "crime_stats_r8_1-5.csv"
OUT_JSON = ROOT / "data" / "prefectures.json"

# 第6表で抽出する犯罪カテゴリ（表中の見出し文字列 -> 表示名）
CATEGORIES = {
    "殺人": "殺人",
    "強盗": "強盗",
    "放火": "放火",
    "不同意性交等": "不同意性交等（旧：強制性交等）",
    "略取誘拐・人身売買": "略取誘拐・人身売買",
    "不同意わいせつ": "不同意わいせつ（旧：強制わいせつ）",
    "ひったくり": "ひったくり",
}

TABLE6_TITLE_RE = re.compile(
    r"^第６表,,,重要犯罪・重要窃盗犯\s*都道府県別\s*認知・検挙件数・検挙人員\s*対前年比較\s*（(.+)）"
)

# 2020年国勢調査（総務省統計局）
POPULATION = {
    "北海道": 5224614, "青森県": 1237984, "岩手県": 1210534, "宮城県": 2301996,
    "秋田県": 959502, "山形県": 1068027, "福島県": 1833152, "茨城県": 2867009,
    "栃木県": 1933146, "群馬県": 1939110, "埼玉県": 7344765, "千葉県": 6284480,
    "東京都": 14047594, "神奈川県": 9237337, "新潟県": 2201272, "富山県": 1034814,
    "石川県": 1132526, "福井県": 766863, "山梨県": 809974, "長野県": 2048011,
    "岐阜県": 1978742, "静岡県": 3633202, "愛知県": 7542415, "三重県": 1770254,
    "滋賀県": 1413610, "京都府": 2578087, "大阪府": 8837685, "兵庫県": 5465002,
    "奈良県": 1324473, "和歌山県": 922584, "鳥取県": 553407, "島根県": 671126,
    "岡山県": 1888432, "広島県": 2799702, "山口県": 1342059, "徳島県": 719559,
    "香川県": 950244, "愛媛県": 1334841, "高知県": 691527, "福岡県": 5135214,
    "佐賀県": 811442, "長崎県": 1312317, "熊本県": 1738301, "大分県": 1123852,
    "宮崎県": 1069576, "鹿児島県": 1588256, "沖縄県": 1467480,
}
PREF_ORDER = list(POPULATION.keys())
PREF_SET = set(PREF_ORDER)


def parse_section(rows, start_idx):
    """第6表の1セクション（カテゴリ1つ分）を読み、{都道府県: {count, count_prev, change_rate}} を返す"""
    i = start_idx
    # ヘッダ行(項目名/年度)を読み飛ばし、"都道府県" 行を見つける
    while i < len(rows) and (len(rows[i]) < 2 or rows[i][1].strip() != "都道府県"):
        i += 1
    i += 1  # 都道府県ヘッダの次から本体データ

    result = {}
    while i < len(rows):
        row = rows[i]
        if not any(c.strip() for c in row):
            break
        col0 = row[0].strip()
        col1 = row[1].strip() if len(row) > 1 else ""

        pref = None
        if col0 == "東京都" and col1 == "":
            pref = "東京都"
        elif col0 == "北海道" and col1 == "計":
            pref = "北海道"
        elif col1 in PREF_SET:
            pref = col1
        # それ以外（方面別の内訳行、地方ブロックの「計」行、総数行など）はスキップ

        if pref:
            def to_int(s):
                s = s.strip().replace(",", "")
                return int(s) if s else 0

            count = to_int(row[2])
            count_prev = to_int(row[3])
            change_rate = row[5].strip() if len(row) > 5 else ""
            result[pref] = {
                "count": count,
                "count_prev": count_prev,
                "change_rate": float(change_rate) if change_rate else None,
            }
        i += 1
    return result, i


def main():
    raw_bytes = RAW_CSV.read_bytes()
    text = raw_bytes.decode("shift_jis", errors="ignore")
    rows = list(csv.reader(io.StringIO(text)))

    category_data = {}
    for idx, row in enumerate(rows):
        line = ",".join(row)
        m = TABLE6_TITLE_RE.match(line)
        if m:
            heading = m.group(1)
            if heading in CATEGORIES:
                data, _ = parse_section(rows, idx)
                if len(data) != 47:
                    raise ValueError(f"{heading}: 47都道府県のうち{len(data)}件しか取得できませんでした")
                category_data[heading] = data

    missing = set(CATEGORIES) - set(category_data)
    if missing:
        raise ValueError(f"カテゴリが見つかりません: {missing}")

    prefectures = {}
    for pref in PREF_ORDER:
        pop = POPULATION[pref]
        cats = {}
        for key, label in CATEGORIES.items():
            d = category_data[key][pref]
            per_100k = round(d["count"] / pop * 100000, 2) if pop else 0
            cats[label] = {
                "count": d["count"],
                "count_prev": d["count_prev"],
                "change_rate": d["change_rate"],
                "per_100k": per_100k,
            }
        total = sum(c["count"] for c in cats.values())
        prefectures[pref] = {
            "population": pop,
            "total": total,
            "total_per_100k": round(total / pop * 100000, 2) if pop else 0,
            "categories": cats,
        }

    output = {
        "meta": {
            "source": "警察庁「犯罪統計資料」(暫定値) 令和8年1〜5月分",
            "source_url": "https://www.e-stat.go.jp/stat-search/files?page=1&layout=datalist&lid=000001483773",
            "population_source": "総務省統計局「令和2年国勢調査」",
            "period": "2026年1〜5月",
            "compare_period": "2025年1〜5月",
            "categories": list(CATEGORIES.values()),
            "note": "刑法犯のうち「重要犯罪」に区分される犯罪種別を、不審者による被害に関連性が高いものとして抽出。件数は暫定値。",
        },
        "prefectures": prefectures,
    }

    OUT_JSON.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote {OUT_JSON} ({len(prefectures)} prefectures, {len(CATEGORIES)} categories)")


if __name__ == "__main__":
    main()

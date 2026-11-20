#!/usr/bin/env python3
"""
data/source/ にある Excel（.xlsx）の「問題DB」シートを読み込み、
アプリ用の JSON（data/questions/<バッチ>.json と data/manifest.json）を作ります。

  python scripts/build_data.py            # 通常（レビュー状況が「要修正」の問題は除外）
  python scripts/build_data.py --all      # すべての問題を含める

・data/source/ に置いた .xlsx はすべて読み込みます（ファイルを分けて追加してOK）。
・問題IDが重複している、正答が A〜D 以外、必須列が空、などのときはエラーで止まります。
"""
import json, sys, glob, os, datetime
from collections import OrderedDict
from openpyxl import load_workbook

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "data", "source")
OUT_DIR = os.path.join(ROOT, "data", "questions")
MANIFEST = os.path.join(ROOT, "data", "manifest.json")
SHEET = "問題DB"
EXCLUDE_STATUS = set() if "--all" in sys.argv else {"要修正"}

# Excelの列名 → JSONのキー
COLS = OrderedDict([
    ("問題ID", "id"), ("教科", "subject"), ("学年", "grade"), ("分野", "field"), ("単元", "unit"),
    ("RSコード", "rs_code"), ("RS項目", "rs_name"), ("本文（素材文）", "passage"),
    ("補足・図表情報", "note"), ("設問文", "question"),
    ("選択肢A", "A"), ("選択肢B", "B"), ("選択肢C", "C"), ("選択肢D", "D"),
    ("正答", "answer"), ("根拠", "explanation"), ("難易度", "difficulty"),
    ("図版要否", "needs_image"), ("バッチ", "batch"), ("レビュー状況", "review_status"),
])
REQUIRED = ["問題ID", "教科", "学年", "RSコード", "本文（素材文）", "設問文",
            "選択肢A", "選択肢B", "選択肢C", "選択肢D", "正答"]
RS_CODES = {"DEP", "ANA", "PARA", "INF", "REP", "INST_DIC", "INST_SCI"}
SUBJECTS = {"国語", "数学", "社会", "理科", "英語"}


def clean(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return str(v).strip()


def main():
    files = sorted(f for f in glob.glob(os.path.join(SRC, "*.xlsx")) if not os.path.basename(f).startswith("~$"))
    if not files:
        sys.exit(f"エラー: {SRC} に .xlsx ファイルがありません。")

    errors, seen, items, skipped = [], {}, [], 0
    for path in files:
        name = os.path.basename(path)
        wb = load_workbook(path, data_only=True, read_only=True)
        if SHEET not in wb.sheetnames:
            errors.append(f"{name}: 「{SHEET}」シートがありません。")
            continue
        rows = wb[SHEET].iter_rows(values_only=True)
        header = [clean(h) for h in next(rows)]
        missing = [c for c in REQUIRED if c not in header]
        if missing:
            errors.append(f"{name}: 必須の列がありません → {', '.join(missing)}")
            continue
        idx = {h: i for i, h in enumerate(header)}
        for rnum, row in enumerate(rows, start=2):
            get = lambda col: clean(row[idx[col]]) if col in idx and idx[col] < len(row) else ""
            if not any(clean(v) for v in row):
                continue  # 空行
            where = f"{name} {rnum}行目"
            rec = {key: get(col) for col, key in COLS.items()}
            empty = [c for c in REQUIRED if not get(c)]
            if empty:
                errors.append(f"{where}: 空欄があります → {', '.join(empty)}")
                continue
            rec["answer"] = rec["answer"].upper()
            if rec["answer"] not in ("A", "B", "C", "D"):
                errors.append(f"{where}: 正答「{rec['answer']}」は A〜D ではありません。")
            if rec["rs_code"] not in RS_CODES:
                errors.append(f"{where}: RSコード「{rec['rs_code']}」が不明です。")
            if rec["subject"] not in SUBJECTS:
                errors.append(f"{where}: 教科「{rec['subject']}」が不明です。")
            if rec["id"] in seen:
                errors.append(f"{where}: 問題ID「{rec['id']}」が重複しています（{seen[rec['id']]} と同じ）。")
                continue
            seen[rec["id"]] = where
            if rec["review_status"] in EXCLUDE_STATUS:
                skipped += 1
                continue
            try:
                rec["difficulty"] = int(rec["difficulty"]) if rec["difficulty"] else 2
            except ValueError:
                rec["difficulty"] = 2
            rec["batch"] = rec["batch"] or "未分類"
            rec["choices"] = [rec.pop(k) for k in ("A", "B", "C", "D")]
            items.append(rec)

    if errors:
        print("データにエラーがあります。修正してから再度実行してください。\n")
        for e in errors:
            print(" - " + e)
        sys.exit(1)

    os.makedirs(OUT_DIR, exist_ok=True)
    for old in glob.glob(os.path.join(OUT_DIR, "*.json")):
        os.remove(old)

    by_batch = OrderedDict()
    for it in sorted(items, key=lambda x: (x["batch"], x["id"])):
        by_batch.setdefault(it["batch"], []).append(it)

    manifest = {
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "total": len(items),
        "files": [],
    }
    for batch, lst in by_batch.items():
        fname = f"{batch}.json"
        with open(os.path.join(OUT_DIR, fname), "w", encoding="utf-8") as f:
            json.dump(lst, f, ensure_ascii=False, indent=1)
        manifest["files"].append({"batch": batch, "path": f"data/questions/{fname}", "count": len(lst)})
    with open(MANIFEST, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)

    print(f"OK: {len(files)}ファイル → {len(items)}問を出力しました（除外 {skipped}問）。")
    for m in manifest["files"]:
        print(f"   {m['batch']}: {m['count']}問")


if __name__ == "__main__":
    main()

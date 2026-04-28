"""Export task rows from query_result xlsx to JSON for the static viewer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pandas as pd


def pretty_rubric_cell(value: object) -> str:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return ""
    s = str(value).strip()
    if not s:
        return ""
    try:
        obj = json.loads(s)
        inner = obj.get("_value", obj) if isinstance(obj, dict) else obj
        return json.dumps(inner, indent=2, ensure_ascii=False)
    except (json.JSONDecodeError, TypeError):
        return s


def main() -> int:
    p = argparse.ArgumentParser(description="Export xlsx task query to tasks.json")
    p.add_argument(
        "xlsx",
        nargs="?",
        default=str(
            Path.home()
            / "Downloads"
            / "query_result_2026-04-28T15_32_29.993107743Z.xlsx"
        ),
        help="Path to query_result xlsx",
    )
    p.add_argument(
        "-o",
        "--output",
        default=str(Path(__file__).resolve().parent.parent / "data" / "tasks.json"),
        help="Output JSON path",
    )
    args = p.parse_args()
    src = Path(args.xlsx)
    if not src.is_file():
        print(f"File not found: {src}", file=sys.stderr)
        return 1

    df = pd.read_excel(src)
    expected = {
        "task_id",
        "task_url",
        "previous_prompt",
        "latest_prompt",
        "previous_rubric",
        "latest_rubric",
    }
    missing = expected - set(df.columns)
    if missing:
        print(f"Missing columns: {missing}", file=sys.stderr)
        return 1

    rows = []
    for _, row in df.iterrows():
        rows.append(
            {
                "task_id": str(row["task_id"]) if pd.notna(row["task_id"]) else "",
                "task_url": str(row["task_url"]) if pd.notna(row["task_url"]) else "",
                "previous_prompt": str(row["previous_prompt"] or "")
                if pd.notna(row["previous_prompt"])
                else "",
                "latest_prompt": str(row["latest_prompt"] or "")
                if pd.notna(row["latest_prompt"])
                else "",
                "previous_rubric": pretty_rubric_cell(row["previous_rubric"]),
                "latest_rubric": pretty_rubric_cell(row["latest_rubric"]),
            }
        )

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(rows)} tasks to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

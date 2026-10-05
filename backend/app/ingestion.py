from __future__ import annotations

import argparse
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSV_PATH = ROOT / "soil_data_all.csv"
NUMERIC_FIELDS = (
    "soil_pH",
    "total_Nitrogen_percent_",
    "total_Org_Carbon_percent_",
    "phosphorus_Olsen_ppm",
    "potassium_meq_percent_",
)

_NUMBER_RE = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$")


def normalize_county_label(value: str | None) -> str:
    """Normalize county labels without claiming an approved administrative crosswalk."""
    text = (value or "").strip()
    if not text:
        return ""
    text = re.sub(r"[_/\\]+", " ", text)
    text = " ".join(text.split())
    return text.casefold()


def normalize_depth_label(value: str | None) -> str:
    """Standardize the source depth label while preserving the original wording where possible."""
    text = (value or "").strip()
    if not text:
        return ""
    return " ".join(text.split()).lower()


def parse_numeric(value: str | None) -> float | None:
    """Accept only plain decimal/exponent numerics; reject text, commas, and NaN-like values."""
    if value is None:
        return None
    candidate = value.strip()
    if not candidate or candidate.lower() in {"nan", "inf", "+inf", "-inf"}:
        return None
    if not _NUMBER_RE.fullmatch(candidate):
        return None
    return float(candidate)


def summarize_csv_import(csv_path: str | Path) -> dict[str, object]:
    """Return a reversible import summary for a source CSV with audit-friendly rejection reasons."""
    source = Path(csv_path)
    rows_read = 0
    rows_accepted = 0
    rows_rejected = 0
    invalid_numeric_tokens = 0
    missing_counties = 0
    missing_identifiers = 0
    rejected_reasons: dict[str, int] = {}

    with source.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            rows_read += 1
            record_id = (row.get("id") or "").strip()
            county = normalize_county_label(row.get("county"))

            if not record_id:
                missing_identifiers += 1
                rejected_reasons["missing_id"] = rejected_reasons.get("missing_id", 0) + 1
                rows_rejected += 1
                continue

            if not county:
                missing_counties += 1
                rejected_reasons["missing_county"] = rejected_reasons.get("missing_county", 0) + 1
                rows_rejected += 1
                continue

            has_invalid_numeric = False
            for field in NUMERIC_FIELDS:
                if (row.get(field) or "").strip() and parse_numeric(row.get(field)) is None:
                    invalid_numeric_tokens += 1
                    has_invalid_numeric = True

            if has_invalid_numeric:
                rejected_reasons["invalid_numeric_token"] = (
                    rejected_reasons.get("invalid_numeric_token", 0) + 1
                )
                rows_rejected += 1
                continue

            rows_accepted += 1

    return {
        "source_path": str(source),
        "rows_read": rows_read,
        "rows_accepted": rows_accepted,
        "rows_rejected": rows_rejected,
        "invalid_numeric_tokens": invalid_numeric_tokens,
        "missing_counties": missing_counties,
        "missing_identifiers": missing_identifiers,
        "rejected_reasons": rejected_reasons,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit-safe project soil CSV ingestion summary.")
    parser.add_argument(
        "--csv",
        type=Path,
        default=DEFAULT_CSV_PATH,
        help="Source CSV path to inspect and normalize.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit JSON instead of a human-readable summary.",
    )
    args = parser.parse_args()

    summary = summarize_csv_import(args.csv)
    if args.json:
        import json

        print(json.dumps(summary, indent=2, sort_keys=True))
        return

    print(f"Source: {summary['source_path']}")
    print(f"Rows read: {summary['rows_read']}")
    print(f"Rows accepted: {summary['rows_accepted']}")
    print(f"Rows rejected: {summary['rows_rejected']}")
    print(f"Invalid numeric tokens: {summary['invalid_numeric_tokens']}")
    print(f"Missing counties: {summary['missing_counties']}")
    print(f"Rejected reasons: {summary['rejected_reasons']}")


if __name__ == "__main__":
    main()

import json
import os
import sys
from pathlib import Path
from src.metrics.extraction_pr import compute_extraction_pr
from src.metrics.citation_validity import compute_citation_validity_pct
from src.metrics.groundedness import compute_groundedness_score
from src.metrics.calibration_ece import compute_calibration_ece

# HUMAN_REVIEW: these thresholds must be approved by a clinical safety reviewer
# before being set. Defaults are vacuously permissive until sign-off.
THRESHOLDS = {
    "extraction_min_f1":      float(os.environ.get("REVITAL_MIN_F1",          "0.0")),
    "citation_min_pct":       float(os.environ.get("REVITAL_MIN_CITATION_PCT", "0.0")),
    "groundedness_min_score": float(os.environ.get("REVITAL_MIN_GROUNDEDNESS", "0.0")),
    "calibration_max_ece":    float(os.environ.get("REVITAL_MAX_ECE",          "1.0")),
}


def run_eval(gold_dir: Path) -> dict:
    results = {}

    extraction_gold_path = gold_dir / "extraction_gold.json"
    if extraction_gold_path.exists():
        data = json.loads(extraction_gold_path.read_text())
        for case in data.get("cases", []):
            m = compute_extraction_pr(case["predicted"], case["gold"])
            results[f"extraction_f1:{case['id']}"] = {
                "value": m.f1,
                "pass": m.f1 >= THRESHOLDS["extraction_min_f1"],
            }

    citation_gold_path = gold_dir / "citation_gold.json"
    if citation_gold_path.exists():
        data = json.loads(citation_gold_path.read_text())
        for case in data.get("cases", []):
            pct = compute_citation_validity_pct(case["assertions"])
            results[f"citation_validity:{case['id']}"] = {
                "value": pct,
                "pass": pct >= THRESHOLDS["citation_min_pct"],
            }

    groundedness_gold_path = gold_dir / "groundedness_gold.json"
    if groundedness_gold_path.exists():
        data = json.loads(groundedness_gold_path.read_text())
        for case in data.get("cases", []):
            score = compute_groundedness_score(case["assertions"], case["spans"])
            results[f"groundedness:{case['id']}"] = {
                "value": score,
                "pass": score >= THRESHOLDS["groundedness_min_score"],
            }

    calibration_gold_path = gold_dir / "calibration_gold.json"
    if calibration_gold_path.exists():
        data = json.loads(calibration_gold_path.read_text())
        for case in data.get("cases", []):
            ece = compute_calibration_ece(
                [(p[0], bool(p[1])) for p in case["pairs"]]
            )
            results[f"calibration_ece:{case['id']}"] = {
                "value": ece,
                "pass": ece <= THRESHOLDS["calibration_max_ece"],
            }

    return results


if __name__ == "__main__":
    gold_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("artifacts/synthetic/revital-gold-sets")
    results = run_eval(gold_dir)
    all_pass = all(r["pass"] for r in results.values())
    for key, r in results.items():
        status = "PASS" if r["pass"] else "FAIL"
        print(f"[{status}] {key}: {r['value']:.3f}")
    sys.exit(0 if all_pass else 1)

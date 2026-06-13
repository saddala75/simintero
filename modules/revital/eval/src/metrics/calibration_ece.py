from typing import List, Tuple
import numpy as np


def compute_calibration_ece(
    confidence_accuracy_pairs: List[Tuple[float, bool]],
    n_bins: int = 10,
) -> float:
    """Expected Calibration Error — lower is better. 0 = perfectly calibrated."""
    if not confidence_accuracy_pairs:
        return 0.0
    confs = np.array([p[0] for p in confidence_accuracy_pairs])
    accs = np.array([float(p[1]) for p in confidence_accuracy_pairs])
    bin_boundaries = np.linspace(0, 1, n_bins + 1)
    ece = 0.0
    for i in range(n_bins):
        mask = (confs >= bin_boundaries[i]) & (confs < bin_boundaries[i + 1])
        if mask.sum() == 0:
            continue
        bin_conf = confs[mask].mean()
        bin_acc = accs[mask].mean()
        ece += (mask.sum() / len(confs)) * abs(bin_conf - bin_acc)
    return float(ece)

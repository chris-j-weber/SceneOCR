import math

import onnxruntime as ort
from rapidocr_onnxruntime import RapidOCR

_reader: RapidOCR | None = None


def _detect_providers() -> list[str]:
    available = ort.get_available_providers()
    if "CUDAExecutionProvider" in available:
        print("[OCR] Using CUDA GPU acceleration", flush=True)
        return ["CUDAExecutionProvider", "CPUExecutionProvider"]
    if "CoreMLExecutionProvider" in available:
        print("[OCR] Using CoreML (Apple) acceleration", flush=True)
        return ["CoreMLExecutionProvider", "CPUExecutionProvider"]
    print("[OCR] Using CPU (no GPU acceleration detected)", flush=True)
    return ["CPUExecutionProvider"]


def get_reader() -> RapidOCR:
    global _reader
    if _reader is None:
        providers = _detect_providers()
        use_cuda = "CUDAExecutionProvider" in providers
        _reader = RapidOCR(
            det_use_cuda=use_cuda,
            rec_use_cuda=use_cuda,
            cls_use_cuda=use_cuda,
        )
    return _reader


# ── geometry helpers ────────────────────────────────────────────────────────

def _angle(poly: list) -> float:
    """Angle of the top edge (TL→TR). Negative = text tilts upward left-to-right."""
    dx = poly[1][0] - poly[0][0]
    dy = poly[1][1] - poly[0][1]
    return math.atan2(dy, dx)


def _center(poly: list) -> tuple[float, float]:
    return sum(p[0] for p in poly) / 4, sum(p[1] for p in poly) / 4


def _perp_height(poly: list) -> float:
    """True character height = length of the left edge (TL→BL)."""
    tl, bl = poly[0], poly[3]
    return math.sqrt((bl[0] - tl[0]) ** 2 + (bl[1] - tl[1]) ** 2)


def _on_same_line(a: dict, b: dict) -> bool:
    """
    True when two detections lie on the same tilted text baseline.

    Thresholds:
      • angle difference  ≤ ~11° (0.2 rad)
      • perpendicular separation ≤ 0.4 × avg character height
      • along-baseline gap ≤ 4 × avg character height
    """
    pa, pb = a["poly"], b["poly"]

    ang_a = _angle(pa)
    ang_b = _angle(pb)
    if abs(ang_a - ang_b) > 0.2:
        return False

    avg_angle = (ang_a + ang_b) / 2
    avg_h = (_perp_height(pa) + _perp_height(pb)) / 2
    if avg_h < 1:
        return False

    ca, cb = _center(pa), _center(pb)

    px = -math.sin(avg_angle)
    py =  math.cos(avg_angle)

    perp_a = ca[0] * px + ca[1] * py
    perp_b = cb[0] * px + cb[1] * py
    if abs(perp_a - perp_b) > avg_h * 0.4:
        return False

    tx = math.cos(avg_angle)
    ty = math.sin(avg_angle)

    def _proj_range(poly: list) -> tuple[float, float]:
        ps = [p[0] * tx + p[1] * ty for p in poly]
        return min(ps), max(ps)

    ra = _proj_range(pa)
    rb = _proj_range(pb)
    gap = max(0.0, max(rb[0] - ra[1], ra[0] - rb[1]))
    return gap <= avg_h * 4


def _merge_polys(pa: list, pb: list) -> list:
    """Take TL+BL from the left box, TR+BR from the right box."""
    ca_x = _center(pa)[0]
    cb_x = _center(pb)[0]
    left, right = (pa, pb) if ca_x <= cb_x else (pb, pa)
    return [left[0], right[1], right[2], left[3]]


def _merge_collinear(detections: list[dict]) -> list[dict]:
    """Iteratively merge co-linear detections into single entries."""
    changed = True
    while changed:
        changed = False
        used = [False] * len(detections)
        result: list[dict] = []

        for i, det_a in enumerate(detections):
            if used[i]:
                continue
            partner = None
            for j in range(i + 1, len(detections)):
                if used[j]:
                    continue
                if _on_same_line(det_a, detections[j]):
                    partner = j
                    break

            if partner is not None:
                det_b = detections[partner]
                left, right = (
                    (det_a, det_b)
                    if _center(det_a["poly"])[0] <= _center(det_b["poly"])[0]
                    else (det_b, det_a)
                )
                result.append({
                    "text":       left["text"] + " " + right["text"],
                    "poly":       _merge_polys(left["poly"], right["poly"]),
                    "confidence": (det_a["confidence"] + det_b["confidence"]) / 2,
                })
                used[i] = used[partner] = True
                changed = True
            else:
                result.append(det_a)
                used[i] = True

        detections = result

    return detections


# ── public API ───────────────────────────────────────────────────────────────

def recognize_frame(image_path: str, skip_merge: bool = False) -> list[dict]:
    """Returns list of {text, poly: [[x,y]×4], confidence}."""
    reader = get_reader()
    result, _ = reader(image_path)

    detections = [
        {
            "text": text.strip(),
            "poly": [[int(p[0]), int(p[1])] for p in bbox],
            "confidence": float(conf),
        }
        for bbox, text, conf in (result or [])
        if conf >= 0.15 and text.strip()
    ]

    if skip_merge:
        return detections
    return _merge_collinear(detections)

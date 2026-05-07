from collections import Counter
from difflib import SequenceMatcher
from typing import Any

from spellchecker import SpellChecker

_spell_de = SpellChecker(language="de")
_spell_en = SpellChecker(language="en")


# ── text similarity ──────────────────────────────────────────────────────────

def _text_sim(a: str, b: str) -> float:
    a, b = a.lower().strip(), b.lower().strip()
    if not a or not b:
        return 0.0
    ratio = SequenceMatcher(None, a, b).ratio()
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)

    # Whole-string prefix: "richard yu" → "richard yuricich"
    if long_.startswith(short) and len(short) / len(long_) >= 0.5:
        ratio = max(ratio, 0.85)

    # First-word prefix: "richa" → "richard yuricich"
    # Handles text that appears incrementally on screen (fade-in, type-on effect).
    first_word = long_.split()[0] if long_.split() else long_
    if (len(short) >= 3
            and first_word.startswith(short)
            and len(short) / len(first_word) >= 0.4):
        ratio = max(ratio, 0.80)

    return ratio


# ── candidate scoring ────────────────────────────────────────────────────────

def _word_validity(word: str) -> float:
    clean = word.strip(".,!?-–—\"'()")
    if not clean:
        return 0.0
    lower = clean.lower()
    if _spell_de.known([lower]) or _spell_en.known([lower]):
        return 1.0
    if clean[0].isupper() and clean.isalpha() and len(clean) >= 2:
        return 0.65
    if clean.isalpha():
        return 0.40
    return 0.20


def _text_validity(text: str) -> float:
    words = text.split()
    if not words:
        return 0.0
    per_word = sum(_word_validity(w) for w in words) / len(words)
    # Multi-word text is more likely correct: two properly-separated words score
    # better than a single merged token of equal per-word validity.
    # Multiplier: ×1.4 for 2 words, ×1.8 for 3+ words, capped at 1.0.
    if len(words) > 1:
        return min(1.0, per_word * (1.0 + 0.4 * min(len(words) - 1, 2)))
    return per_word


def _centroid_score(candidate: str, all_texts: list[str]) -> float:
    if len(all_texts) <= 1:
        return 1.0
    c = candidate.lower()
    return sum(SequenceMatcher(None, c, t.lower()).ratio() for t in all_texts) / len(all_texts)


def _best_candidate(all_texts: list[str]) -> str:
    counts = Counter(all_texts)
    total  = len(all_texts)
    unique = list(counts.keys())
    if len(unique) == 1:
        return unique[0]
    best, best_score = unique[0], -1.0
    for candidate in unique:
        # Lower frequency weight so that a spaced version ("ANDREW RONA") can
        # beat a more-frequent merged token ("ANDREWRONA") via the validity bonus.
        score = (0.20 * counts[candidate] / total
                 + 0.55 * _text_validity(candidate)
                 + 0.25 * _centroid_score(candidate, all_texts))
        if score > best_score:
            best_score, best = score, candidate
    return best


def _known(word: str) -> bool:
    return bool(_spell_en.known([word]) or _spell_de.known([word]))


def _fix_missing_spaces(text: str) -> str:
    """
    Split tokens where the OCR dropped an internal space, e.g. 'MUSICBY' → 'MUSIC BY'.

    Strategy per token:
    1. Skip if the token is already a known word or too short.
    2. Try every split point (min 2 chars each side).
       Accept the FIRST split where BOTH halves are known dictionary words,
       OR the right half is itself recursively further split.
    3. Recursively try to split the right half further (handles 3-word runs).

    Strict requirement prevents false splits of proper names ('ANDREWRONA') that
    are not in the dictionary — those are handled upstream by _best_candidate
    preferring the correctly-spaced version from OCR frames that produced it.
    """
    def _try_split(token: str) -> str:
        lower = token.lower()
        if len(token) <= 4 or _known(lower):
            return token
        # Require at least 3 chars on the left so short function words like
        # "AN", "BY" don't falsely split longer tokens ("ANDREW" → "AN DREW").
        for i in range(3, len(token) - 1):
            left  = token[:i]
            right = token[i:]
            if _known(left.lower()):
                fixed_right = _try_split(right)
                if fixed_right != right or _known(right.lower()):
                    return left + " " + fixed_right
        return token

    return " ".join(_try_split(t) for t in text.split())


# ── geometry ─────────────────────────────────────────────────────────────────

def _poly_to_bbox(poly: list) -> list:
    xs = [p[0] for p in poly]
    ys = [p[1] for p in poly]
    return [min(xs), min(ys), max(xs), max(ys)]


def _bbox_area(bbox: list) -> float:
    return (bbox[2] - bbox[0]) * (bbox[3] - bbox[1])


def _iou(b1: list, b2: list) -> float:
    ix1, iy1 = max(b1[0], b2[0]), max(b1[1], b2[1])
    ix2, iy2 = min(b1[2], b2[2]), min(b1[3], b2[3])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    union = (b1[2]-b1[0])*(b1[3]-b1[1]) + (b2[2]-b2[0])*(b2[3]-b2[1]) - inter
    return inter / union if union > 0 else 0.0


# ── main grouper ─────────────────────────────────────────────────────────────

def group_text_tracks(
    frame_results: list[list[dict]],
    timestamps: list[float],
    gap_tolerance_seconds: float = 3.0,
    text_threshold: float = 0.70,
) -> list[dict]:
    """
    Merge per-frame OCR detections into continuous text tracks.

    Returns list of {text, start_time, end_time, poly, polys, confidence}.
    `poly` is the largest-area representative polygon.
    `polys` is a list of {time, poly} entries — one per matched frame — so
    the frontend can show the exact bounding box position at each moment.
    """
    active: list[dict[str, Any]] = []
    completed: list[dict[str, Any]] = []

    for ts, detections in zip(timestamps, frame_results):
        matched: set[int] = set()

        for track in active:
            best_id, best_score = None, 0.0
            for i, det in enumerate(detections):
                if i in matched:
                    continue
                t = _text_sim(track["last_text"], det["text"])
                if t < text_threshold:
                    continue
                pos = _iou(_poly_to_bbox(track["last_poly"]), _poly_to_bbox(det["poly"]))
                score = 0.65 * t + 0.35 * pos
                if score > best_score:
                    best_score, best_id = score, i

            if best_id is not None:
                det = detections[best_id]
                poly_area = _bbox_area(_poly_to_bbox(det["poly"]))
                track.update(end_time=ts, last_text=det["text"],
                             last_poly=det["poly"], last_seen_time=ts)
                if poly_area > track["best_poly_area"]:
                    track["best_poly"] = det["poly"]
                    track["best_poly_area"] = poly_area
                track["all_texts"].append(det["text"])
                # Record the actual poly position at this timestamp
                track["all_polys"].append({"time": round(ts, 3), "poly": det["poly"]})
                matched.add(best_id)

        still_active = []
        for track in active:
            if ts - track["last_seen_time"] > gap_tolerance_seconds:
                completed.append(track)
            else:
                still_active.append(track)
        active = still_active

        for i, det in enumerate(detections):
            if i not in matched:
                poly_area = _bbox_area(_poly_to_bbox(det["poly"]))
                active.append({
                    "start_time": ts, "end_time": ts,
                    "last_text": det["text"], "last_poly": det["poly"],
                    "best_poly": det["poly"], "best_poly_area": poly_area,
                    "last_seen_time": ts,
                    "all_texts": [det["text"]],
                    "all_polys": [{"time": round(ts, 3), "poly": det["poly"]}],
                    "confidence": det["confidence"],
                })

    completed.extend(active)

    results = []
    for t in completed:
        results.append({
            "text":       _fix_missing_spaces(_best_candidate(t["all_texts"])),
            "start_time": round(t["start_time"], 3),
            "end_time":   round(t["end_time"],   3),
            "poly":       t["best_poly"],
            "polys":      t["all_polys"],
            "confidence": round(t["confidence"], 3),
        })

    results.sort(key=lambda x: x["start_time"])
    return results

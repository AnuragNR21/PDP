"""
Assisted matching — pure domain logic, no I/O.

Discover proposes, the user confirms. Nothing here decides anything on its own:
every suggestion carries a confidence and the method that produced it, so the
user can see why a value was matched before accepting it.

Used for value-level classification (`KIOSK` → **Kiosk Transformer**) and for
proposing schema-level mappings (`Transformer_ID` → **Transformer Identifier**).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

#: Words that carry no distinguishing meaning when comparing names.
STOP_TOKENS = {
    "the", "of", "a", "an", "type", "types", "code", "codes",
    "id", "identifier", "ref", "reference", "no", "num", "number",
    "mounted", "style",
}

#: Common source-side abbreviations expanded before comparison.
ABBREVIATIONS = {
    "tx": "transformer",
    "trans": "transformer",
    "xfmr": "transformer",
    "dev": "device",
    "nwk": "network",
    "net": "network",
    "sub": "substation",
    "acct": "account",
    "cust": "customer",
    "addr": "address",
    "qty": "quantity",
    "amt": "amount",
    "dt": "date",
    "desc": "description",
}

CONFIDENCE_EXACT = 1.0
CONFIDENCE_NORMALISED = 0.95
CONFIDENCE_CONTAINED = 0.8
#: A source value that is one of the words of a governed name, e.g. KIOSK.
CONFIDENCE_SUBSET = 0.82
#: Below this, a suggestion is offered only as a weak candidate.
MIN_SUGGESTION_CONFIDENCE = 0.45


@dataclass
class MatchSuggestion:
    target_node_id: str
    target_name: str
    confidence: float
    method: str


def normalise(text: str) -> str:
    """Lower-case, strip punctuation and separators: `TX_ID` → `txid`."""
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def tokenise(text: str) -> list[str]:
    """
    Split a name into meaningful, expanded tokens.
    `Transformer_ID` → ['transformer'];  `TX_ID` → ['transformer'].
    """
    parts = re.split(r"[^A-Za-z0-9]+", text or "")
    tokens: list[str] = []
    for part in parts:
        if not part:
            continue
        # Split camelCase / PascalCase runs: TransformerId → Transformer, Id
        for piece in re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z0-9]*|[a-z0-9]+", part):
            token = piece.lower()
            token = ABBREVIATIONS.get(token, token)
            if token and token not in STOP_TOKENS:
                tokens.append(token)
    return tokens


def _token_similarity(left: list[str], right: list[str]) -> float:
    """Overlap of two token sets, weighted towards covering the source tokens."""
    if not left or not right:
        return 0.0
    left_set, right_set = set(left), set(right)
    shared = left_set & right_set
    if not shared:
        # Fall back to prefix agreement so 'kiosk' still meets 'kiosks'.
        shared = {
            l for l in left_set
            for r in right_set
            if len(l) >= 4 and (l.startswith(r) or r.startswith(l))
        }
        if not shared:
            return 0.0
    return len(shared) / max(len(left_set), len(right_set))


def score_candidate(source: str, candidate: str) -> tuple[float, str]:
    """
    Score one candidate name against a source name, with the method used.

    Every strategy is evaluated and the strongest wins. Returning on the first
    match that fires would under-score the classification case: `KIOSK` is
    literally contained in `Kiosk Transformer`, but scoring that by string
    length alone buries a match that is obvious once you compare words.
    """
    source_norm, candidate_norm = normalise(source), normalise(candidate)
    if not source_norm or not candidate_norm:
        return 0.0, "none"

    if source_norm == candidate_norm:
        return CONFIDENCE_EXACT, "exact name"

    source_tokens, candidate_tokens = tokenise(source), tokenise(candidate)
    scores: list[tuple[float, str]] = []

    if source_tokens and source_tokens == candidate_tokens:
        scores.append((CONFIDENCE_NORMALISED, "normalised name"))

    # A source value that is one of the words of a governed name is the usual
    # shape of a classification: KIOSK → Kiosk Transformer.
    if source_tokens and candidate_tokens:
        source_set, candidate_set = set(source_tokens), set(candidate_tokens)
        if source_set <= candidate_set or candidate_set <= source_set:
            coverage = len(source_set & candidate_set) / max(len(source_set), len(candidate_set))
            scores.append((round(CONFIDENCE_SUBSET + coverage * 0.1, 3), "matches wording"))

    if source_norm in candidate_norm or candidate_norm in source_norm:
        shorter = min(len(source_norm), len(candidate_norm))
        longer = max(len(source_norm), len(candidate_norm))
        scores.append((round(CONFIDENCE_CONTAINED * (shorter / longer) + 0.15, 3), "contained in name"))

    similarity = _token_similarity(source_tokens, candidate_tokens)
    if similarity > 0:
        scores.append((round(0.5 + similarity * 0.4, 3), "similar wording"))

    if not scores:
        return 0.0, "none"
    return max(scores, key=lambda entry: entry[0])


def suggest_match(
    source: str,
    candidates: list[dict],
    name_key: str = "name",
    id_key: str = "node_id",
) -> MatchSuggestion | None:
    """
    Best governed candidate for a source name or value, or None when nothing
    scores well enough to be worth showing.
    """
    best: MatchSuggestion | None = None
    for candidate in candidates:
        confidence, method = score_candidate(source, str(candidate.get(name_key, "")))
        if confidence <= 0:
            continue
        closer_than_best = (
            best is not None
            and confidence == best.confidence
            and len(tokenise(str(candidate.get(name_key, "")))) < len(tokenise(best.target_name))
        )
        if best is None or confidence > best.confidence or closer_than_best:
            best = MatchSuggestion(
                target_node_id=str(candidate.get(id_key, "")),
                target_name=str(candidate.get(name_key, "")),
                confidence=round(confidence, 3),
                method=method,
            )
    if best is None or best.confidence < MIN_SUGGESTION_CONFIDENCE:
        return None
    return best

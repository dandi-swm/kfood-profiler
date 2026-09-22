import unicodedata


def normalize_label(s: str | None) -> str:
    if not s:
        return ""
    return unicodedata.normalize("NFC", s).strip().replace(" ", "")


def is_correct(predicted: str | None, truth: str) -> bool:
    p = normalize_label(predicted)
    return bool(p) and p == normalize_label(truth)

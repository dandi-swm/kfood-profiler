import unicodedata


def test_nfd_nfc_equivalence():
    from app.grading import is_correct, normalize_label

    nfd = unicodedata.normalize("NFD", "김치찌개")
    nfc = unicodedata.normalize("NFC", "김치찌개")
    assert nfd != nfc  # 전제: 실제로 다른 바이트열
    assert normalize_label(nfd) == normalize_label(nfc)
    assert is_correct(nfd, nfc)


def test_whitespace_and_empty():
    from app.grading import is_correct

    assert is_correct(" 김치 찌개 ", "김치찌개")
    assert not is_correct("", "김치찌개")
    assert not is_correct(None, "김치찌개")
    assert not is_correct("된장찌개", "김치찌개")

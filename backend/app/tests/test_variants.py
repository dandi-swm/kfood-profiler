from PIL import Image


def test_variant_generation(tmp_path):
    from app.variants import generate_variant

    src = tmp_path / "src.jpg"
    Image.new("RGB", (800, 600), color=(120, 60, 30)).save(src, "JPEG", quality=95)
    out_dir = tmp_path / "out"

    _, w, h, orig_bytes = generate_variant("original", src, out_dir)
    assert (w, h) == (800, 600)

    _, w, h, _ = generate_variant("resize512", src, out_dir)
    assert max(w, h) == 512 and (w, h) == (512, 384)

    _, w, h, _ = generate_variant("resize256", src, out_dir)
    assert max(w, h) == 256

    _, w85, h85, b85 = generate_variant("q85", src, out_dir)
    _, w50, h50, b50 = generate_variant("q50", src, out_dir)
    assert (w85, h85) == (800, 600) and (w50, h50) == (800, 600)
    assert b50 < b85  # 낮은 품질 → 더 작은 파일

    # 멱등성: 다시 호출해도 결과 동일
    _, w2, h2, b2 = generate_variant("resize512", src, out_dir)
    assert (w2, h2) == (512, 384)

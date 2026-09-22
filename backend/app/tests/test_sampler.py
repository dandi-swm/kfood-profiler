def test_sampler_deterministic_and_filters(test_env):
    import app.dataset as dataset_module
    from app.sampler import pick_samples_for_class

    dataset_module._source = None  # settings 변경 반영

    a = pick_samples_for_class("갈비구이", seed=42, per_class=2)
    b = pick_samples_for_class("갈비구이", seed=42, per_class=2)
    c = pick_samples_for_class("갈비구이", seed=7, per_class=2)

    assert a == b  # 같은 시드 → 동일 집합
    assert len(a) == 2
    assert [x[0] for x in a] != [x[0] for x in c] or a != c  # 다른 시드 → 다른 순서/집합

    # 자격 필터: 300×200 이미지(Img_000_9999)는 절대 선택되지 않아야 함
    everything = pick_samples_for_class("갈비구이", seed=1, per_class=100)
    assert all("9999" not in rel for rel, *_ in everything)
    assert all(max(w, h) >= 512 for _, w, h, _ in everything)


def test_jpeg_dimension_reader(test_env, fake_dataset):
    import app.dataset as dataset_module
    from app.dataset import read_jpeg_dimensions

    dataset_module._source = None
    source = dataset_module.get_dataset_source()
    rel = source.list_images("갈비구이")[0]
    dims = read_jpeg_dimensions(source.abs_path(rel))
    assert dims in ((800, 600), (300, 200))

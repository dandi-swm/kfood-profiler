"""시드 고정 층화 샘플링 → manifest 생성 + 변형 파일 생성.

클래스별 독립 시드(random.Random(f"{seed}:{class_label}"))로 셔플하므로
클래스를 추가/제거해도 다른 클래스의 샘플 집합은 변하지 않는다.
최장변 < min_longest_side 인 이미지는 제외해 resize 변형이 항상
진짜 다운스케일이 되게 한다.
"""

import asyncio
import logging
import random

from sqlalchemy import select

from .config import settings
from .dataset import get_dataset_source, read_jpeg_dimensions
from .db import new_session
from .orm import Sample, SampleManifest, Variant
from .variants import VARIANT_TYPES, generate_variant

logger = logging.getLogger(__name__)


def pick_samples_for_class(
    class_label: str,
    seed: int,
    per_class: int,
    min_longest_side: int | None = None,
) -> list[tuple[str, int, int, int]]:
    """(rel_path, width, height, bytes) 목록을 결정적으로 선택."""
    if min_longest_side is None:
        min_longest_side = settings.min_longest_side
    source = get_dataset_source()
    paths = source.list_images(class_label)  # 이미 정렬됨 → 결정적
    rng = random.Random(f"{seed}:{class_label}")
    rng.shuffle(paths)

    picked: list[tuple[str, int, int, int]] = []
    for rel in paths:
        if len(picked) >= per_class:
            break
        abs_path = source.abs_path(rel)
        dims = read_jpeg_dimensions(abs_path)
        if dims is None:
            continue
        w, h = dims
        if max(w, h) < min_longest_side:
            continue
        picked.append((rel, w, h, abs_path.stat().st_size))
    return picked


def build_manifest_sync(manifest_id: int) -> None:
    """샘플 선택 + 변형 생성. 스레드에서 실행됨 (CPU/IO 바운드)."""
    with new_session() as db:
        manifest = db.get(SampleManifest, manifest_id)
        assert manifest is not None
        source = get_dataset_source()
        try:
            classes = source.scan_classes()
            if manifest.class_filter:
                wanted = set(manifest.class_filter)
                classes = [c for c in classes if c.label in wanted]

            for ci in classes:
                existing = db.scalar(
                    select(Sample.id).where(
                        Sample.manifest_id == manifest_id,
                        Sample.class_label == ci.label,
                    ).limit(1)
                )
                if existing:
                    continue  # 재실행(resume) 시 스킵
                picks = pick_samples_for_class(ci.label, manifest.seed, manifest.per_class)
                for rel, w, h, size in picks:
                    db.add(Sample(
                        manifest_id=manifest_id,
                        class_label=ci.label,
                        category=ci.category,
                        rel_path=rel,
                        orig_width=w,
                        orig_height=h,
                        orig_bytes=size,
                    ))
                db.commit()

            samples = db.scalars(
                select(Sample).where(Sample.manifest_id == manifest_id)
            ).all()
            for sample in samples:
                src = source.abs_path(sample.rel_path)
                out_dir = settings.variants_dir / str(sample.id)
                existing_types = {
                    v.variant_type
                    for v in db.scalars(
                        select(Variant).where(Variant.sample_id == sample.id)
                    )
                }
                for vt in manifest.variant_types:
                    if vt in existing_types:
                        continue
                    path, w, h, size = generate_variant(vt, src, out_dir)
                    db.add(Variant(
                        sample_id=sample.id,
                        variant_type=vt,
                        file_path=str(path),
                        width=w,
                        height=h,
                        bytes=size,
                    ))
                db.commit()

            manifest.status = "ready"
            db.commit()
        except Exception as e:  # noqa: BLE001
            logger.exception("manifest %s build failed", manifest_id)
            db.rollback()
            manifest.status = "failed"
            manifest.error = str(e)
            db.commit()


async def build_manifest(manifest_id: int) -> None:
    await asyncio.to_thread(build_manifest_sync, manifest_id)


def default_variant_types() -> list[str]:
    return list(VARIANT_TYPES)

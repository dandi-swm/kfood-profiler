import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..orm import Run, Sample, SampleManifest, Variant
from ..sampler import build_manifest
from ..schemas import ManifestCreate, ManifestOut
from ..variants import VARIANT_TYPES

router = APIRouter(prefix="/api/manifests", tags=["manifests"])


def _to_out(db: Session, m: SampleManifest) -> ManifestOut:
    sample_count = db.scalar(
        select(func.count(Sample.id)).where(Sample.manifest_id == m.id)
    )
    class_count = db.scalar(
        select(func.count(func.distinct(Sample.class_label))).where(
            Sample.manifest_id == m.id
        )
    )
    out = ManifestOut.model_validate(m)
    out.sample_count = sample_count or 0
    out.class_count = class_count or 0
    return out


@router.post("", response_model=ManifestOut)
async def create_manifest(body: ManifestCreate, db: Session = Depends(get_session)):
    invalid = set(body.variant_types) - set(VARIANT_TYPES)
    if invalid:
        raise HTTPException(400, f"알 수 없는 variant type: {sorted(invalid)}")
    if db.scalar(select(SampleManifest).where(SampleManifest.name == body.name)):
        raise HTTPException(409, f"같은 이름의 manifest가 이미 있습니다: {body.name}")

    from ..config import settings

    manifest = SampleManifest(
        name=body.name,
        seed=body.seed,
        per_class=body.per_class,
        class_filter=body.class_filter,
        dataset_root=str(settings.dataset_root),
        variant_types=body.variant_types,
        status="creating",
    )
    db.add(manifest)
    db.commit()
    asyncio.create_task(build_manifest(manifest.id))
    return _to_out(db, manifest)


@router.get("", response_model=list[ManifestOut])
def list_manifests(db: Session = Depends(get_session)):
    manifests = db.scalars(
        select(SampleManifest).order_by(SampleManifest.id.desc())
    ).all()
    return [_to_out(db, m) for m in manifests]


@router.get("/{manifest_id}", response_model=ManifestOut)
def get_manifest(manifest_id: int, db: Session = Depends(get_session)):
    m = db.get(SampleManifest, manifest_id)
    if m is None:
        raise HTTPException(404, "manifest 없음")
    return _to_out(db, m)


@router.get("/{manifest_id}/classes")
def manifest_class_summary(manifest_id: int, db: Session = Depends(get_session)):
    rows = db.execute(
        select(
            Sample.class_label,
            Sample.category,
            func.count(Sample.id),
            func.min(func.max(Sample.orig_width, Sample.orig_height)),
            func.max(func.max(Sample.orig_width, Sample.orig_height)),
        )
        .where(Sample.manifest_id == manifest_id)
        .group_by(Sample.class_label, Sample.category)
        .order_by(Sample.class_label)
    ).all()
    return [
        {
            "class_label": label,
            "category": cat,
            "sample_count": n,
            "min_longest_side": lo,
            "max_longest_side": hi,
        }
        for label, cat, n, lo, hi in rows
    ]


@router.delete("/{manifest_id}")
def delete_manifest(manifest_id: int, db: Session = Depends(get_session)):
    m = db.get(SampleManifest, manifest_id)
    if m is None:
        raise HTTPException(404, "manifest 없음")
    if db.scalar(select(Run.id).where(Run.manifest_id == manifest_id).limit(1)):
        raise HTTPException(409, "이 manifest를 사용한 run이 있어 삭제할 수 없습니다")
    sample_ids = db.scalars(
        select(Sample.id).where(Sample.manifest_id == manifest_id)
    ).all()
    if sample_ids:
        db.query(Variant).filter(Variant.sample_id.in_(sample_ids)).delete(
            synchronize_session=False
        )
        db.query(Sample).filter(Sample.manifest_id == manifest_id).delete(
            synchronize_session=False
        )
    db.delete(m)
    db.commit()
    return {"deleted": manifest_id}

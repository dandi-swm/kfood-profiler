from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..aggregate import DIMENSIONS, aggregate
from ..db import get_session
from ..orm import Prediction, Sample, Variant
from ..schemas import PredictionOut, PredictionPage

router = APIRouter(prefix="/api", tags=["results"])


@router.get("/results/aggregate")
def results_aggregate(
    run_ids: str = Query(..., description="쉼표 구분 run id 목록"),
    group_by: str = Query("variant_type", description="쉼표 구분: run_id,class_label,category,variant_type"),
    class_label: str | None = None,
    category: str | None = None,
    variant_type: str | None = None,
    db: Session = Depends(get_session),
):
    try:
        ids = [int(x) for x in run_ids.split(",") if x.strip()]
    except ValueError:
        raise HTTPException(400, "run_ids 형식 오류")
    dims = [g.strip() for g in group_by.split(",") if g.strip()]
    bad = [g for g in dims if g not in DIMENSIONS]
    if bad:
        raise HTTPException(400, f"알 수 없는 group_by 차원: {bad}")
    return aggregate(
        db, ids, dims,
        class_label=class_label, category=category, variant_type=variant_type,
    )


@router.get("/predictions", response_model=PredictionPage)
def list_predictions(
    run_id: int,
    class_label: str | None = None,
    category: str | None = None,
    variant_type: str | None = None,
    is_correct: bool | None = None,
    status: str | None = None,
    sample_id: int | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_session),
):
    stmt = (
        select(Prediction, Variant, Sample)
        .join(Variant, Prediction.variant_id == Variant.id)
        .join(Sample, Variant.sample_id == Sample.id)
        .where(Prediction.run_id == run_id)
    )
    if class_label:
        stmt = stmt.where(Sample.class_label == class_label)
    if category:
        stmt = stmt.where(Sample.category == category)
    if variant_type:
        stmt = stmt.where(Variant.variant_type == variant_type)
    if is_correct is not None:
        stmt = stmt.where(Prediction.is_correct == is_correct)
    if status:
        stmt = stmt.where(Prediction.status == status)
    if sample_id:
        stmt = stmt.where(Sample.id == sample_id)

    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.execute(
        stmt.order_by(Sample.id, Variant.id).offset((page - 1) * page_size).limit(page_size)
    ).all()

    items = [
        PredictionOut(
            id=p.id,
            run_id=p.run_id,
            variant_id=v.id,
            sample_id=s.id,
            class_label=s.class_label,
            category=s.category,
            variant_type=v.variant_type,
            width=v.width,
            height=v.height,
            bytes=v.bytes,
            status=p.status,
            raw_response=p.raw_response,
            predicted_label=p.predicted_label,
            is_correct=p.is_correct,
            latency_ms=p.latency_ms,
            input_tokens=p.input_tokens,
            output_tokens=p.output_tokens,
            cost_usd=p.cost_usd,
            error=p.error,
        )
        for p, v, s in rows
    ]
    return PredictionPage(items=items, total=total or 0, page=page, page_size=page_size)

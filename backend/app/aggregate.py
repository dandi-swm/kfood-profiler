"""대시보드 집계: predictions ⋈ variants ⋈ samples 를 임의 차원으로 group by."""

from sqlalchemy import Float, cast, func, select

from .orm import Prediction, Run, Sample, Variant

DIMENSIONS = {
    "run_id": Prediction.run_id,
    "model_id": Run.model_id,
    "class_label": Sample.class_label,
    "category": Sample.category,
    "variant_type": Variant.variant_type,
}


def aggregate(
    db,
    run_ids: list[int],
    group_by: list[str],
    class_label: str | None = None,
    category: str | None = None,
    variant_type: str | None = None,
) -> list[dict]:
    dims = [DIMENSIONS[g] for g in group_by if g in DIMENSIONS]

    stmt = (
        select(
            *dims,
            func.count(Prediction.id).label("count"),
            func.sum(func.iif(Prediction.status == "error", 1, 0)).label("errors"),
            func.avg(cast(Prediction.is_correct, Float)).label("accuracy"),
            func.avg(Prediction.latency_ms).label("avg_latency_ms"),
            func.coalesce(func.sum(Prediction.input_tokens), 0).label("input_tokens"),
            func.coalesce(func.sum(Prediction.output_tokens), 0).label("output_tokens"),
            func.coalesce(func.sum(Prediction.cost_usd), 0.0).label("cost_usd"),
        )
        .join(Variant, Prediction.variant_id == Variant.id)
        .join(Sample, Variant.sample_id == Sample.id)
        .join(Run, Prediction.run_id == Run.id)
        .where(Prediction.run_id.in_(run_ids))
    )
    if class_label:
        stmt = stmt.where(Sample.class_label == class_label)
    if category:
        stmt = stmt.where(Sample.category == category)
    if variant_type:
        stmt = stmt.where(Variant.variant_type == variant_type)
    if dims:
        stmt = stmt.group_by(*dims).order_by(*dims)

    group_keys = [g for g in group_by if g in DIMENSIONS]
    rows = db.execute(stmt).all()
    out = []
    for row in rows:
        m = row._mapping
        item = {k: m[DIMENSIONS[k].key if k != "run_id" else "run_id"] for k in group_keys}
        item.update(
            count=m["count"],
            errors=m["errors"] or 0,
            accuracy=m["accuracy"],
            avg_latency_ms=m["avg_latency_ms"],
            input_tokens=m["input_tokens"],
            output_tokens=m["output_tokens"],
            cost_usd=m["cost_usd"],
        )
        out.append(item)
    return out

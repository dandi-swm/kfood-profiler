from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models_registry import MODEL_CATALOG
from ..orm import Run, Sample, SampleManifest, Variant
from ..runner import build_prompt, cancel_run, get_class_list, get_progress, start_run
from ..schemas import RunCreate, RunOut

router = APIRouter(prefix="/api/runs", tags=["runs"])


@router.post("", response_model=RunOut)
async def create_run(body: RunCreate, db: Session = Depends(get_session)):
    manifest = db.get(SampleManifest, body.manifest_id)
    if manifest is None:
        raise HTTPException(404, "manifest 없음")
    if manifest.status != "ready":
        raise HTTPException(409, f"manifest 상태가 ready가 아닙니다: {manifest.status}")
    info = MODEL_CATALOG.get(body.model_id)
    if info is None:
        raise HTTPException(400, f"알 수 없는 모델: {body.model_id}")
    missing = set(body.variant_types) - set(manifest.variant_types)
    if missing:
        raise HTTPException(400, f"manifest에 없는 variant type: {sorted(missing)}")

    total_items = db.scalar(
        select(func.count(Variant.id))
        .join(Sample, Variant.sample_id == Sample.id)
        .where(
            Sample.manifest_id == body.manifest_id,
            Variant.variant_type.in_(body.variant_types),
        )
    )
    class_list = get_class_list(db, body.manifest_id)

    from ..config import settings

    run = Run(
        name=body.name,
        manifest_id=body.manifest_id,
        model_id=body.model_id,
        provider=info.provider,
        api_path="vertex" if (info.provider == "gemini" and settings.use_vertexai) else "api-key",
        prompt_version="v1",
        prompt_text=build_prompt(class_list),
        variant_types=body.variant_types,
        concurrency=body.concurrency,
        cost_per_m_input=info.usd_per_m_input,
        cost_per_m_output=info.usd_per_m_output,
        status="pending",
        total_items=total_items or 0,
    )
    db.add(run)
    db.commit()
    start_run(run.id)
    return run


@router.get("", response_model=list[RunOut])
def list_runs(db: Session = Depends(get_session)):
    return db.scalars(select(Run).order_by(Run.id.desc())).all()


@router.get("/{run_id}", response_model=RunOut)
def get_run(run_id: int, db: Session = Depends(get_session)):
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run 없음")
    return run


@router.post("/{run_id}/cancel")
def cancel(run_id: int, db: Session = Depends(get_session)):
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run 없음")
    if not cancel_run(run_id):
        raise HTTPException(409, "실행 중인 run이 아닙니다")
    return {"cancelling": run_id}


@router.get("/{run_id}/progress")
def progress(run_id: int, db: Session = Depends(get_session)):
    if db.get(Run, run_id) is None:
        raise HTTPException(404, "run 없음")
    return get_progress(db, run_id)


@router.delete("/{run_id}")
def delete_run(run_id: int, db: Session = Depends(get_session)):
    from ..orm import Prediction
    from ..runner import is_run_active

    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run 없음")
    if run.status in ("running", "pending") or is_run_active(run_id):
        raise HTTPException(409, "실행 중인 run은 먼저 취소한 뒤 삭제하세요")
    db.query(Prediction).filter(Prediction.run_id == run_id).delete(
        synchronize_session=False
    )
    db.delete(run)
    db.commit()
    return {"deleted": run_id}


@router.post("/{run_id}/resume", response_model=RunOut)
async def resume(run_id: int, db: Session = Depends(get_session)):
    """failed/cancelled run을 이어서 실행 (성공한 항목은 스킵, 에러 항목은 재시도)."""
    run = db.get(Run, run_id)
    if run is None:
        raise HTTPException(404, "run 없음")
    if run.status in ("running", "pending"):
        raise HTTPException(409, "이미 실행 중입니다")
    from ..orm import Prediction

    db.query(Prediction).filter(
        Prediction.run_id == run_id, Prediction.status == "error"
    ).delete(synchronize_session=False)
    run.status = "pending"
    run.error = None
    run.finished_at = None
    db.commit()
    start_run(run.id)
    return run

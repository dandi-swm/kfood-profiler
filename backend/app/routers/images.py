from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from ..dataset import get_dataset_source
from ..db import get_session
from ..orm import Sample, Variant

router = APIRouter(prefix="/api/images", tags=["images"])


@router.get("/variants/{variant_id}")
def get_variant_image(variant_id: int, db: Session = Depends(get_session)):
    v = db.get(Variant, variant_id)
    if v is None or not Path(v.file_path).exists():
        raise HTTPException(404, "variant 이미지 없음")
    return FileResponse(v.file_path, media_type="image/jpeg")


@router.get("/samples/{sample_id}")
def get_sample_image(sample_id: int, db: Session = Depends(get_session)):
    s = db.get(Sample, sample_id)
    if s is None:
        raise HTTPException(404, "sample 없음")
    path = get_dataset_source().abs_path(s.rel_path)
    if not path.exists():
        raise HTTPException(404, "원본 이미지 없음")
    return FileResponse(path, media_type="image/jpeg")

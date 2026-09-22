from fastapi import APIRouter

from ..dataset import get_dataset_source
from ..schemas import ClassInfoOut

router = APIRouter(prefix="/api/dataset", tags=["dataset"])


@router.get("/classes", response_model=list[ClassInfoOut])
def list_classes():
    return [
        ClassInfoOut(label=c.label, category=c.category, image_count=c.image_count)
        for c in get_dataset_source().scan_classes()
    ]

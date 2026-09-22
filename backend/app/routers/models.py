from fastapi import APIRouter

from ..models_registry import MODEL_CATALOG
from ..schemas import ModelOut

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=list[ModelOut])
def list_models():
    return [
        ModelOut(
            model_id=m.model_id,
            provider=m.provider,
            display_name=m.display_name,
            usd_per_m_input=m.usd_per_m_input,
            usd_per_m_output=m.usd_per_m_output,
            thinking=m.thinking,
        )
        for m in MODEL_CATALOG.values()
    ]

from datetime import datetime

from pydantic import BaseModel, Field

from .variants import VARIANT_TYPES


class ClassInfoOut(BaseModel):
    label: str
    category: str
    image_count: int


class ModelOut(BaseModel):
    model_id: str
    provider: str
    display_name: str
    usd_per_m_input: float
    usd_per_m_output: float
    thinking: bool = False


class ManifestCreate(BaseModel):
    name: str
    seed: int = 42
    per_class: int = Field(default=20, ge=1, le=200)
    class_filter: list[str] | None = None
    variant_types: list[str] = Field(default_factory=lambda: list(VARIANT_TYPES))


class ManifestOut(BaseModel):
    id: int
    name: str
    seed: int
    per_class: int
    class_filter: list[str] | None
    variant_types: list[str]
    status: str
    error: str | None
    created_at: datetime
    sample_count: int = 0
    class_count: int = 0

    model_config = {"from_attributes": True}


class RunCreate(BaseModel):
    name: str
    manifest_id: int
    model_id: str
    variant_types: list[str] = Field(default_factory=lambda: list(VARIANT_TYPES))
    concurrency: int = Field(default=4, ge=1, le=32)


class RunOut(BaseModel):
    id: int
    name: str
    manifest_id: int
    model_id: str
    provider: str
    prompt_version: str
    variant_types: list[str]
    concurrency: int
    status: str
    total_items: int
    started_at: datetime | None
    finished_at: datetime | None
    error: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PredictionOut(BaseModel):
    id: int
    run_id: int
    variant_id: int
    sample_id: int
    class_label: str
    category: str
    variant_type: str
    width: int
    height: int
    bytes: int
    status: str
    raw_response: str | None
    predicted_label: str | None
    is_correct: bool | None
    latency_ms: int | None
    input_tokens: int | None
    output_tokens: int | None
    cost_usd: float | None
    error: str | None


class PredictionPage(BaseModel):
    items: list[PredictionOut]
    total: int
    page: int
    page_size: int

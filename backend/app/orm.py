from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Index,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class SampleManifest(Base):
    __tablename__ = "sample_manifests"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String, unique=True)
    seed: Mapped[int] = mapped_column(Integer)
    per_class: Mapped[int] = mapped_column(Integer)
    class_filter: Mapped[list | None] = mapped_column(JSON, nullable=True)
    dataset_root: Mapped[str] = mapped_column(String)
    variant_types: Mapped[list] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String, default="creating")  # creating|ready|failed
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    samples: Mapped[list["Sample"]] = relationship(back_populates="manifest")


class Sample(Base):
    __tablename__ = "samples"
    __table_args__ = (UniqueConstraint("manifest_id", "rel_path"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    manifest_id: Mapped[int] = mapped_column(ForeignKey("sample_manifests.id"))
    class_label: Mapped[str] = mapped_column(String, index=True)  # NFC
    category: Mapped[str] = mapped_column(String)  # NFC
    rel_path: Mapped[str] = mapped_column(String)
    orig_width: Mapped[int] = mapped_column(Integer)
    orig_height: Mapped[int] = mapped_column(Integer)
    orig_bytes: Mapped[int] = mapped_column(Integer)

    manifest: Mapped[SampleManifest] = relationship(back_populates="samples")
    variants: Mapped[list["Variant"]] = relationship(back_populates="sample")


class Variant(Base):
    __tablename__ = "variants"
    __table_args__ = (UniqueConstraint("sample_id", "variant_type"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sample_id: Mapped[int] = mapped_column(ForeignKey("samples.id"))
    variant_type: Mapped[str] = mapped_column(String)  # original|resize512|resize256|q85|q50
    file_path: Mapped[str] = mapped_column(String)
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    bytes: Mapped[int] = mapped_column(Integer)

    sample: Mapped[Sample] = relationship(back_populates="variants")


class Run(Base):
    __tablename__ = "runs"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String)
    manifest_id: Mapped[int] = mapped_column(ForeignKey("sample_manifests.id"))
    model_id: Mapped[str] = mapped_column(String)
    provider: Mapped[str] = mapped_column(String)
    prompt_version: Mapped[str] = mapped_column(String, default="v1")
    prompt_text: Mapped[str] = mapped_column(Text)
    variant_types: Mapped[list] = mapped_column(JSON)
    concurrency: Mapped[int] = mapped_column(Integer, default=4)
    cost_per_m_input: Mapped[float] = mapped_column(Float, default=0.0)
    cost_per_m_output: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String, default="pending")
    # pending|running|completed|cancelled|failed
    total_items: Mapped[int] = mapped_column(Integer, default=0)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Prediction(Base):
    __tablename__ = "predictions"
    __table_args__ = (
        UniqueConstraint("run_id", "variant_id"),
        Index("ix_predictions_run", "run_id"),
        Index("ix_predictions_run_correct", "run_id", "is_correct"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    run_id: Mapped[int] = mapped_column(ForeignKey("runs.id"))
    variant_id: Mapped[int] = mapped_column(ForeignKey("variants.id"))
    status: Mapped[str] = mapped_column(String, default="ok")  # ok|error
    raw_response: Mapped[str | None] = mapped_column(Text, nullable=True)
    predicted_label: Mapped[str | None] = mapped_column(String, nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

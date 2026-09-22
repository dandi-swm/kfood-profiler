"""테스트 run 실행기.

- asyncio task + 세마포어 동시성 제어
- 항목별 재시도(지수 백오프, 429 retry-delay 존중), 실패는 error prediction 행으로 격리
- 이미 prediction 이 있는 variant 는 스킵 → 크래시/취소 후 재실행 시 자동 resume
- 취소: cancel_event → 항목 사이에서 중단, 완료분 유지
"""

import asyncio
import logging
import random
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

from sqlalchemy import func, select

from .db import new_session
from .grading import is_correct, normalize_label
from .orm import Prediction, Run, Sample, SampleManifest, Variant
from .providers.base import ProviderError, RateLimitError
from .providers.registry import create_provider

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 4

PROMPT_V1 = (
    "다음은 한국 음식 사진입니다. 아래 목록 중 정확히 하나의 음식 이름으로만 답하세요.\n"
    "목록: {class_list}"
)


@dataclass
class RunHandle:
    task: asyncio.Task
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)


_handles: dict[int, RunHandle] = {}


def build_prompt(class_list: list[str]) -> str:
    return PROMPT_V1.format(class_list=", ".join(class_list))


def get_class_list(db, manifest_id: int) -> list[str]:
    rows = db.scalars(
        select(Sample.class_label)
        .where(Sample.manifest_id == manifest_id)
        .distinct()
        .order_by(Sample.class_label)
    ).all()
    return list(rows)


@dataclass
class WorkItem:
    variant_id: int
    file_path: str
    truth_label: str


def _load_work_items(db, run: Run) -> list[WorkItem]:
    done_variant_ids = set(
        db.scalars(select(Prediction.variant_id).where(Prediction.run_id == run.id)).all()
    )
    rows = db.execute(
        select(Variant.id, Variant.file_path, Sample.class_label)
        .join(Sample, Variant.sample_id == Sample.id)
        .where(
            Sample.manifest_id == run.manifest_id,
            Variant.variant_type.in_(run.variant_types),
        )
        .order_by(Variant.id)
    ).all()
    return [
        WorkItem(variant_id=vid, file_path=fp, truth_label=label)
        for vid, fp, label in rows
        if vid not in done_variant_ids
    ]


async def _process_item(
    item: WorkItem,
    run: Run,
    provider,
    class_list: list[str],
    prompt: str,
) -> Prediction:
    image_bytes = await asyncio.to_thread(Path(item.file_path).read_bytes)
    last_error: Exception | None = None

    for attempt in range(MAX_ATTEMPTS):
        try:
            result = await provider.classify(
                image_bytes,
                "image/jpeg",
                class_list,
                prompt,
                truth_label=item.truth_label,
                item_key=f"{run.id}:{item.variant_id}",
            )
            cost = None
            if result.input_tokens is not None and result.output_tokens is not None:
                cost = (
                    result.input_tokens / 1e6 * run.cost_per_m_input
                    + result.output_tokens / 1e6 * run.cost_per_m_output
                )
            return Prediction(
                run_id=run.id,
                variant_id=item.variant_id,
                status="ok",
                raw_response=result.raw_text,
                predicted_label=normalize_label(result.raw_text),
                is_correct=is_correct(result.raw_text, item.truth_label),
                latency_ms=result.latency_ms,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                cost_usd=cost,
            )
        except RateLimitError as e:
            last_error = e
            delay = e.retry_after_s or min(2**attempt * 1.0, 30.0)
            await asyncio.sleep(delay + random.uniform(0, 1))
        except ProviderError as e:
            last_error = e
            await asyncio.sleep(min(2**attempt * 1.0, 30.0) + random.uniform(0, 0.5))

    return Prediction(
        run_id=run.id,
        variant_id=item.variant_id,
        status="error",
        error=str(last_error),
    )


async def execute_run(run_id: int) -> None:
    handle = _handles[run_id]
    with new_session() as db:
        run = db.get(Run, run_id)
        assert run is not None
        run.status = "running"
        run.started_at = datetime.now(timezone.utc)
        db.commit()

        try:
            provider, _info = create_provider(run.model_id)
        except ProviderError as e:
            run.status = "failed"
            run.error = str(e)
            run.finished_at = datetime.now(timezone.utc)
            db.commit()
            return

        class_list = get_class_list(db, run.manifest_id)
        prompt = run.prompt_text
        items = _load_work_items(db, run)

    semaphore = asyncio.Semaphore(run.concurrency)

    async def worker(item: WorkItem) -> None:
        if handle.cancel_event.is_set():
            return
        async with semaphore:
            if handle.cancel_event.is_set():
                return
            prediction = await _process_item(item, run, provider, class_list, prompt)
            # 결과별 짧은 트랜잭션으로 즉시 기록 → 진행률/resume 이 DB만으로 성립
            await asyncio.to_thread(_save_prediction, prediction)

    try:
        await asyncio.gather(*(worker(i) for i in items))
        final_status = "cancelled" if handle.cancel_event.is_set() else "completed"
    except asyncio.CancelledError:
        final_status = "cancelled"
    except Exception as e:  # noqa: BLE001
        logger.exception("run %s failed", run_id)
        final_status = "failed"
        with new_session() as db:
            run = db.get(Run, run_id)
            run.error = str(e)
            db.commit()

    with new_session() as db:
        run = db.get(Run, run_id)
        run.status = final_status
        run.finished_at = datetime.now(timezone.utc)
        db.commit()
    _handles.pop(run_id, None)


def _save_prediction(prediction: Prediction) -> None:
    with new_session() as db:
        db.add(prediction)
        db.commit()


def start_run(run_id: int) -> None:
    """이벤트 루프 위에서 호출되어야 함 (async 엔드포인트에서 사용)."""
    handle = RunHandle(task=None)  # type: ignore[arg-type]
    _handles[run_id] = handle
    handle.task = asyncio.create_task(execute_run(run_id))


def cancel_run(run_id: int) -> bool:
    handle = _handles.get(run_id)
    if handle is None:
        return False
    handle.cancel_event.set()
    return True


def is_run_active(run_id: int) -> bool:
    return run_id in _handles


def get_progress(db, run_id: int) -> dict:
    run = db.get(Run, run_id)
    done, errors, cost = db.execute(
        select(
            func.count(Prediction.id),
            func.sum(func.iif(Prediction.status == "error", 1, 0)),
            func.coalesce(func.sum(Prediction.cost_usd), 0.0),
        ).where(Prediction.run_id == run_id)
    ).one()
    elapsed_s = None
    if run.started_at:
        end = run.finished_at or datetime.now(timezone.utc)
        started = run.started_at
        if started.tzinfo is None:
            started = started.replace(tzinfo=timezone.utc)
        if end.tzinfo is None:
            end = end.replace(tzinfo=timezone.utc)
        elapsed_s = (end - started).total_seconds()
    return {
        "run_id": run_id,
        "status": run.status,
        "done": done,
        "errors": errors or 0,
        "total": run.total_items,
        "elapsed_s": elapsed_s,
        "est_cost_so_far": cost,
    }


def recover_interrupted_runs() -> None:
    """startup 시 running 으로 남은 run 을 failed 로 마킹 (재실행 시 resume)."""
    with new_session() as db:
        for run in db.scalars(select(Run).where(Run.status.in_(["pending", "running"]))):
            run.status = "failed"
            run.error = "서버 재시작으로 중단됨 (재실행하면 이어서 진행)"
        db.commit()

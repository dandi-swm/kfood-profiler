"""프로파일링 결과를 정적 리포트 사이트용 데이터로 내보낸다.

사용법:
    cd backend && .venv/bin/python scripts/export_report.py [출력디렉토리]

내보내는 것 (기본: ../report-data):
- meta.json                  : 완료된 run 목록 + 생성 시각
- predictions/{run_id}.json  : run별 전체 예측 (샘플/변형 메타 조인)
- images/variants/{id}.jpg   : 오답/에러가 있는 샘플의 변형 썸네일 (최대 256px)
- images/samples/{id}.jpg    : 내보낸 run에 등장하는 "모든" 샘플의 원본 미리보기 (최대 800px)

변형 이미지가 없는(전부 정답인) 샘플은 프론트가 원본 미리보기로 폴백한다.
"""

import json
import sys
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from PIL import Image, ImageOps
from sqlalchemy import select

from app.dataset import get_dataset_source
from app.db import new_session
from app.orm import Prediction, Run, Sample, Variant


def save_thumb(src_bytes: bytes, out_path: Path, max_side: int, quality: int) -> None:
    img = Image.open(BytesIO(src_bytes))
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    img.thumbnail((max_side, max_side), Image.LANCZOS)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path, "JPEG", quality=quality)


def main() -> None:
    out = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent.parent / "report-data")
    out.mkdir(parents=True, exist_ok=True)
    (out / "predictions").mkdir(exist_ok=True)

    with new_session() as db:
        runs = db.scalars(
            select(Run).where(Run.status == "completed").order_by(Run.id)
        ).all()
        if not runs:
            print("완료된 run이 없습니다.")
            return

        meta = {
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "runs": [
                {
                    "id": r.id,
                    "name": r.name,
                    "manifest_id": r.manifest_id,
                    "model_id": r.model_id,
                    "provider": r.provider,
                    "api_path": r.api_path,
                    "prompt_version": r.prompt_version,
                    "variant_types": r.variant_types,
                    "concurrency": r.concurrency,
                    "status": r.status,
                    "total_items": r.total_items,
                    "started_at": r.started_at.isoformat() if r.started_at else None,
                    "finished_at": r.finished_at.isoformat() if r.finished_at else None,
                    "error": r.error,
                    "created_at": r.created_at.isoformat(),
                }
                for r in runs
            ],
        }
        (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False))

        wrong_sample_ids: set[int] = set()
        for r in runs:
            rows = db.execute(
                select(Prediction, Variant, Sample)
                .join(Variant, Prediction.variant_id == Variant.id)
                .join(Sample, Variant.sample_id == Sample.id)
                .where(Prediction.run_id == r.id)
                .order_by(Sample.id, Variant.id)
            ).all()
            items = []
            for p, v, s in rows:
                items.append({
                    "id": p.id,
                    "run_id": p.run_id,
                    "variant_id": v.id,
                    "sample_id": s.id,
                    "class_label": s.class_label,
                    "category": s.category,
                    "variant_type": v.variant_type,
                    "width": v.width,
                    "height": v.height,
                    "bytes": v.bytes,
                    "status": p.status,
                    "raw_response": p.raw_response,
                    "predicted_label": p.predicted_label,
                    "is_correct": p.is_correct,
                    "latency_ms": p.latency_ms,
                    "input_tokens": p.input_tokens,
                    "output_tokens": p.output_tokens,
                    "cost_usd": p.cost_usd,
                    "error": p.error,
                })
                if p.status == "error" or p.is_correct is False:
                    wrong_sample_ids.add(s.id)
            (out / "predictions" / f"{r.id}.json").write_text(
                json.dumps(items, ensure_ascii=False)
            )
            print(f"run {r.id}: 예측 {len(items)}건 내보냄")

        # 오답 샘플: 변형별 썸네일 (실제 변형 파일 기준)
        print(f"오답/에러 샘플 {len(wrong_sample_ids)}개의 변형 썸네일 내보내는 중…")
        n_var = 0
        for sid in sorted(wrong_sample_ids):
            variants = db.scalars(select(Variant).where(Variant.sample_id == sid)).all()
            for v in variants:
                dst = out / "images" / "variants" / f"{v.id}.jpg"
                if dst.exists():
                    continue
                src = Path(v.file_path)
                if not src.exists():
                    continue
                save_thumb(src.read_bytes(), dst, max_side=256, quality=80)
                n_var += 1

        # 모든 샘플: 원본 미리보기 (정답 샘플의 폴백 + 라이트박스용)
        all_sample_ids = {
            sid
            for (sid,) in db.execute(
                select(Sample.id)
                .join(Variant, Variant.sample_id == Sample.id)
                .join(Prediction, Prediction.variant_id == Variant.id)
                .where(Prediction.run_id.in_([r.id for r in runs]))
                .distinct()
            )
        }
        print(f"전체 샘플 {len(all_sample_ids)}개의 원본 미리보기 내보내는 중…")
        source = get_dataset_source()
        n_smp = 0
        for sid in sorted(all_sample_ids):
            dst = out / "images" / "samples" / f"{sid}.jpg"
            if dst.exists():
                continue
            sample = db.get(Sample, sid)
            try:
                save_thumb(source.read_bytes(sample.rel_path), dst, max_side=800, quality=85)
                n_smp += 1
            except OSError:
                pass
        print(f"변형 썸네일 {n_var}개, 원본 미리보기 {n_smp}개")

    total_mb = sum(f.stat().st_size for f in out.rglob("*") if f.is_file()) / 1e6
    print(f"완료: {out} (총 {total_mb:.1f}MB)")


if __name__ == "__main__":
    main()

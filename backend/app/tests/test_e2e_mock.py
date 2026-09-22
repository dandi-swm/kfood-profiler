"""mock 프로바이더로 API 비용 없이 전체 흐름 검증:
manifest 생성 → 변형 5종 생성 → run 실행 → 집계/드릴다운/이미지 서빙.
"""

import time


def _wait_for(fn, timeout=30.0, interval=0.2):
    deadline = time.time() + timeout
    while time.time() < deadline:
        result = fn()
        if result:
            return result
        time.sleep(interval)
    raise TimeoutError("condition not met in time")


def test_full_flow(app_client):
    import app.dataset as dataset_module

    dataset_module._source = None

    # 0) 데이터셋/모델 조회
    classes = app_client.get("/api/dataset/classes").json()
    assert {c["label"] for c in classes} == {"갈비구이", "김치찌개"}
    models = app_client.get("/api/models").json()
    assert any(m["model_id"] == "mock-80" for m in models)

    # 1) manifest: 2클래스 × 2장 → 4샘플 × 5변형 = 20
    r = app_client.post("/api/manifests", json={
        "name": "e2e", "seed": 42, "per_class": 2,
    })
    assert r.status_code == 200, r.text
    manifest_id = r.json()["id"]

    manifest = _wait_for(lambda: (
        (m := app_client.get(f"/api/manifests/{manifest_id}").json())
        if app_client.get(f"/api/manifests/{manifest_id}").json()["status"] != "creating"
        else None
    ))
    assert manifest["status"] == "ready", manifest
    assert manifest["sample_count"] == 4
    assert manifest["class_count"] == 2

    # 2) run 실행 (mock, 5변형 전부)
    r = app_client.post("/api/runs", json={
        "name": "e2e-run", "manifest_id": manifest_id,
        "model_id": "mock-80", "concurrency": 8,
    })
    assert r.status_code == 200, r.text
    run = r.json()
    assert run["total_items"] == 20

    progress = _wait_for(lambda: (
        (p := app_client.get(f"/api/runs/{run['id']}/progress").json())
        if app_client.get(f"/api/runs/{run['id']}/progress").json()["status"]
        in ("completed", "failed", "cancelled")
        else None
    ))
    assert progress["status"] == "completed", progress
    assert progress["done"] == 20
    assert progress["errors"] == 0

    # 3) 변형별 집계: 5행, 각 count=4
    agg = app_client.get(
        "/api/results/aggregate",
        params={"run_ids": str(run["id"]), "group_by": "variant_type"},
    ).json()
    assert len(agg) == 5
    assert all(row["count"] == 4 for row in agg)
    assert all(0.0 <= (row["accuracy"] or 0) <= 1.0 for row in agg)

    # 클래스×변형 매트릭스
    agg2 = app_client.get(
        "/api/results/aggregate",
        params={"run_ids": str(run["id"]), "group_by": "class_label,variant_type"},
    ).json()
    assert len(agg2) == 10

    # 4) 드릴다운 + 이미지
    page = app_client.get(
        "/api/predictions", params={"run_id": run["id"], "variant_type": "resize256"}
    ).json()
    assert page["total"] == 4
    item = page["items"][0]
    assert item["width"] <= 256 and item["height"] <= 256

    img = app_client.get(f"/api/images/variants/{item['variant_id']}")
    assert img.status_code == 200
    assert img.headers["content-type"] == "image/jpeg"
    img2 = app_client.get(f"/api/images/samples/{item['sample_id']}")
    assert img2.status_code == 200


def test_cancel_and_resume(app_client):
    import app.dataset as dataset_module

    dataset_module._source = None

    r = app_client.post("/api/manifests", json={
        "name": "cancel-test", "seed": 7, "per_class": 2,
    })
    manifest_id = r.json()["id"]
    _wait_for(lambda: (
        app_client.get(f"/api/manifests/{manifest_id}").json()["status"] == "ready"
        or None
    ))

    # 느린 mock이 없으므로 동시성 1로 돌리고 곧바로 취소
    r = app_client.post("/api/runs", json={
        "name": "cancel-run", "manifest_id": manifest_id,
        "model_id": "mock-80", "concurrency": 1,
    })
    run_id = r.json()["id"]
    app_client.post(f"/api/runs/{run_id}/cancel")

    progress = _wait_for(lambda: (
        (p := app_client.get(f"/api/runs/{run_id}/progress").json())
        if app_client.get(f"/api/runs/{run_id}/progress").json()["status"]
        in ("completed", "cancelled", "failed")
        else None
    ))
    assert progress["status"] in ("cancelled", "completed")

    # resume으로 남은 항목 채우기 (completed였다면 스킵되어 그대로 20)
    r = app_client.post(f"/api/runs/{run_id}/resume")
    assert r.status_code == 200
    progress = _wait_for(lambda: (
        (p := app_client.get(f"/api/runs/{run_id}/progress").json())
        if app_client.get(f"/api/runs/{run_id}/progress").json()["status"] == "completed"
        else None
    ))
    assert progress["done"] == 20
    assert progress["errors"] == 0


def test_resume_retries_errored_items(app_client):
    """resume은 성공 항목은 유지하고 에러 항목만 지워 재시도해야 한다."""
    import sqlalchemy as sa

    from app.db import new_session
    from app.orm import Prediction, Run

    runs = app_client.get('/api/runs').json()
    run_id = next(r['id'] for r in runs if r['status'] == 'completed')

    # 완료된 run의 prediction 2개를 인위적으로 에러로 바꾸고 run을 failed 처리
    with new_session() as db:
        ids = db.scalars(
            sa.select(Prediction.id).where(Prediction.run_id == run_id).limit(2)
        ).all()
        db.query(Prediction).filter(Prediction.id.in_(ids)).update(
            {'status': 'error', 'is_correct': None, 'error': 'fake 429'},
            synchronize_session=False,
        )
        db.get(Run, run_id).status = 'failed'
        db.commit()
        total = db.scalar(
            sa.select(sa.func.count(Prediction.id)).where(Prediction.run_id == run_id)
        )

    r = app_client.post(f'/api/runs/{run_id}/resume')
    assert r.status_code == 200

    progress = _wait_for(lambda: (
        (p := app_client.get(f'/api/runs/{run_id}/progress').json())
        if app_client.get(f'/api/runs/{run_id}/progress').json()['status'] == 'completed'
        else None
    ))
    assert progress['done'] == total  # 에러 2건이 재시도되어 다시 채워짐
    assert progress['errors'] == 0

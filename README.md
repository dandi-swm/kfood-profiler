# K-Food AI Profiler

음식 사진 판별 모델(Gemini Flash 등)의 성능을 **음식 클래스별 / 이미지 해상도별 / 파일 크기(압축 품질)별**로 프로파일링하는 로컬 웹 애플리케이션.

## 핵심 개념

- **Manifest(샘플셋)**: kfood 데이터셋(143클래스 × ~1,000장)에서 시드 고정 층화 샘플링으로 클래스당 N장을 뽑고, 각 이미지마다 5개 변형을 생성:
  - `original` (원본, 실측 치수 기록) / `resize512` / `resize256` (최장변 축소) / `q85` / `q50` (JPEG 재압축)
  - 최장변 512px 미만 이미지는 자동 제외 (resize 변형이 무의미하므로)
  - 같은 시드 = 같은 샘플 → 모델 간 공정 비교
- **Run(테스트 실행)**: manifest × 모델 × 변형 선택 → 각 변형 이미지를 모델에 보내 closed-set 분류(전체 클래스 목록 중 하나 선택). 5개 변형이 전부 같은 사진에서 나오므로 변형 간 정확도 차이 = 순수한 해상도/압축 효과.
- **대시보드**: 변형별/클래스별/모델별 정확도·지연·토큰·비용 집계, 클래스×변형 매트릭스, 같은 사진의 변형 5종 나란히 비교.

## 실행

```bash
# 백엔드 (http://localhost:8000)
cd backend
python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"   # 최초 1회
.venv/bin/uvicorn app.main:app --port 8000

# 프론트엔드 (http://localhost:5173)
cd frontend
npm install    # 최초 1회
npm run dev
```

`.env` (profiler/ 루트):

```
GEMINI_API_KEY=...
```

## 사용 순서

1. **샘플셋** 페이지에서 manifest 생성 (기본: 143클래스 × 20장 = 2,860샘플, 변형 생성에 수 분)
2. **테스트 실행** 페이지에서 run 시작 — 먼저 `mock-80` 모델로 파이프라인 확인 후 실제 모델 사용 권장
3. **대시보드**에서 변형별/클래스별 정확도 확인, run 다중 선택으로 모델 비교
4. **드릴다운**에서 개별 예측과 "같은 사진 변형 비교" 확인

비용 감각: 전체 기본 실행(2,860샘플 × 5변형 ≈ 14,300호출)은 Gemini Flash 기준 약 $5 내외 (스모크 실측: 호출당 ~$0.00035). 취소/이어서 실행(resume) 지원.

## 모델 추가

`backend/app/models_registry.py`에 항목 추가 + (새 프로바이더라면) `backend/app/providers/`에 `VisionProvider` 구현.

## 테스트

```bash
cd backend && .venv/bin/python -m pytest   # mock 프로바이더 E2E 포함, API 비용 0
```

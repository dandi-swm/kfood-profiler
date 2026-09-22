"""모델 카탈로그 + 단가표 (USD / 1M tokens).

단가는 run 생성 시 run 행에 스냅샷되므로, 여기 값을 바꿔도 과거 run의
비용 집계는 변하지 않는다. 새 모델 추가 = 여기 한 줄 + providers/ 구현.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class ModelInfo:
    model_id: str  # 카탈로그 키 (UI에 노출)
    provider: str  # providers/registry.py 의 키
    provider_model: str  # 프로바이더 API에 넘기는 실제 모델명
    display_name: str
    usd_per_m_input: float
    usd_per_m_output: float


MODEL_CATALOG: dict[str, ModelInfo] = {
    m.model_id: m
    for m in [
        ModelInfo(
            model_id="gemini-3.8-flash",
            provider="gemini",
            provider_model="gemini-3.8-flash",
            display_name="Gemini 3.8 Flash",
            usd_per_m_input=0.30,
            usd_per_m_output=2.50,
        ),
        ModelInfo(
            model_id="gemini-3.5-flash-lite",
            provider="gemini",
            provider_model="gemini-3.5-flash-lite",
            display_name="Gemini 3.5 Flash Lite",
            usd_per_m_input=0.10,
            usd_per_m_output=0.40,
        ),
        ModelInfo(
            model_id="mock-80",
            provider="mock",
            provider_model="mock:0.8",
            display_name="Mock (80% 정답, 비용 0)",
            usd_per_m_input=0.0,
            usd_per_m_output=0.0,
        ),
        ModelInfo(
            model_id="mock-perfect",
            provider="mock",
            provider_model="mock:1.0",
            display_name="Mock (100% 정답, 비용 0)",
            usd_per_m_input=0.0,
            usd_per_m_output=0.0,
        ),
    ]
}

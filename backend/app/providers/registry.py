from ..models_registry import MODEL_CATALOG, ModelInfo
from .base import ProviderError, VisionProvider
from .mock import MockProvider


def create_provider(model_id: str) -> tuple[VisionProvider, ModelInfo]:
    info = MODEL_CATALOG.get(model_id)
    if info is None:
        raise ProviderError(f"알 수 없는 모델: {model_id}")

    if info.provider == "mock":
        accuracy = float(info.provider_model.split(":")[1])
        return MockProvider(accuracy=accuracy), info
    if info.provider == "gemini":
        from .gemini import GeminiProvider  # google-genai 미설치 환경 배려한 지연 임포트

        return GeminiProvider(model=info.provider_model), info
    raise ProviderError(f"알 수 없는 프로바이더: {info.provider}")

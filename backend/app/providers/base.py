from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class PredictionResult:
    raw_text: str
    input_tokens: int | None
    output_tokens: int | None
    latency_ms: int


class ProviderError(Exception):
    """복구 불가능하거나 일반적인 프로바이더 오류."""


class RateLimitError(ProviderError):
    """429 등 레이트 리밋. retry_after_s가 있으면 그만큼 대기 후 재시도."""

    def __init__(self, message: str, retry_after_s: float | None = None):
        super().__init__(message)
        self.retry_after_s = retry_after_s


class VisionProvider(ABC):
    @abstractmethod
    async def classify(
        self,
        image_bytes: bytes,
        mime: str,
        class_list: list[str],
        prompt: str,
        *,
        truth_label: str | None = None,
        item_key: str | None = None,
    ) -> PredictionResult:
        """이미지를 분류해 클래스 목록 중 하나의 라벨 텍스트를 반환.

        truth_label / item_key 는 mock 프로바이더 전용 힌트로,
        실제 프로바이더는 무시해야 한다.
        """

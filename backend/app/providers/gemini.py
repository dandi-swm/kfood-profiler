import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

from ..config import settings
from .base import PredictionResult, ProviderError, RateLimitError, VisionProvider


class GeminiProvider(VisionProvider):
    def __init__(self, model: str):
        if not settings.gemini_api_key:
            raise ProviderError("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)")
        self.model = model
        self.client = genai.Client(api_key=settings.gemini_api_key)

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
        started = time.monotonic()
        try:
            response = await self.client.aio.models.generate_content(
                model=self.model,
                contents=[
                    genai_types.Part.from_bytes(data=image_bytes, mime_type=mime),
                    prompt,
                ],
                config=genai_types.GenerateContentConfig(
                    # enum 구조화 출력으로 closed-set 분류를 강제
                    response_mime_type="text/x.enum",
                    response_schema={"type": "STRING", "enum": class_list},
                    temperature=0.0,
                    # 분류에는 thinking이 불필요한데 출력 단가로 과금됨 → 최소화
                    # (모델에 따라 완전히 0이 되지 않고 소량 남을 수 있음)
                    thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
                ),
            )
        except genai_errors.APIError as e:
            if e.code == 429:
                raise RateLimitError(str(e), retry_after_s=_retry_delay(e)) from e
            raise ProviderError(f"Gemini API error {e.code}: {e.message}") from e

        latency_ms = int((time.monotonic() - started) * 1000)
        usage = response.usage_metadata
        # thinking(thoughts) 토큰도 출력 단가로 과금되므로 output에 합산해야
        # 비용 추정이 실제 청구액과 일치한다
        candidates = getattr(usage, "candidates_token_count", None) or 0
        thoughts = getattr(usage, "thoughts_token_count", None) or 0
        return PredictionResult(
            raw_text=(response.text or "").strip(),
            input_tokens=getattr(usage, "prompt_token_count", None),
            output_tokens=candidates + thoughts,
            latency_ms=latency_ms,
        )


def _retry_delay(e: "genai_errors.APIError") -> float | None:
    try:
        details = e.details.get("error", {}).get("details", [])
        for d in details:
            if "RetryInfo" in str(d.get("@type", "")):
                delay = d.get("retryDelay", "")  # 예: "17s"
                if isinstance(delay, str) and delay.endswith("s"):
                    return float(delay[:-1])
    except (AttributeError, ValueError, TypeError):
        pass
    return None

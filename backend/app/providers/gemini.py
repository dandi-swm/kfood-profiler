import time

from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types

from ..config import settings
from .base import PredictionResult, ProviderError, RateLimitError, VisionProvider


class GeminiProvider(VisionProvider):
    def __init__(self, model: str, thinking: bool = False):
        if not settings.gemini_api_key:
            raise ProviderError("GEMINI_API_KEY가 설정되지 않았습니다 (.env 확인)")
        self.model = model
        self.thinking = thinking
        # 일부 모델(예: 3.5-flash-lite)은 thinking_budget=0을 400으로 거부하고
        # 기본값이 이미 thinking off다. 첫 400에서 감지해 config 생략으로 폴백.
        self._budget_zero_unsupported = False
        self.client = genai.Client(api_key=settings.gemini_api_key)

    def _thinking_config(self) -> "genai_types.ThinkingConfig | None":
        if self.thinking:
            # 명시적 동적 thinking (기본이 off인 모델에서도 켜지도록)
            return genai_types.ThinkingConfig(thinking_budget=-1)
        if self._budget_zero_unsupported:
            return None
        return genai_types.ThinkingConfig(thinking_budget=0)

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
        for attempt_without_budget in (False, True):
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
                        thinking_config=self._thinking_config(),
                    ),
                )
                break
            except genai_errors.APIError as e:
                if e.code == 429:
                    raise RateLimitError(str(e), retry_after_s=_retry_delay(e)) from e
                if (
                    e.code == 400
                    and not self.thinking
                    and not self._budget_zero_unsupported
                    and not attempt_without_budget
                ):
                    # budget=0 미지원 모델 → config 생략으로 1회 재시도 후 고정
                    self._budget_zero_unsupported = True
                    continue
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

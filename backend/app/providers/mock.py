"""API 비용 없이 전체 파이프라인을 검증하기 위한 mock 프로바이더.

item_key 기반 시드라 같은 항목은 항상 같은 결과 → 테스트가 결정적.
"""

import asyncio
import random

from .base import PredictionResult, VisionProvider


class MockProvider(VisionProvider):
    def __init__(self, accuracy: float = 0.8, latency_range_ms: tuple[int, int] = (5, 20)):
        self.accuracy = accuracy
        self.latency_range_ms = latency_range_ms

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
        rng = random.Random(f"mock:{item_key}:{self.accuracy}")
        latency = rng.randint(*self.latency_range_ms)
        await asyncio.sleep(latency / 1000)

        if truth_label and rng.random() < self.accuracy:
            answer = truth_label
        else:
            wrong = [c for c in class_list if c != truth_label] or class_list
            answer = rng.choice(wrong)

        return PredictionResult(
            raw_text=answer,
            input_tokens=1500 + len(image_bytes) // 1000,
            output_tokens=len(answer),
            latency_ms=latency,
        )

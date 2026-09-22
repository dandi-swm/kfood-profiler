from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=PROJECT_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    dataset_root: Path = PROJECT_ROOT.parent / "kfood"
    data_dir: Path = PROJECT_ROOT / "data"
    gemini_api_key: str = ""

    # 샘플러 자격 기준: 최장변이 이 값 미만인 이미지는 샘플에서 제외
    min_longest_side: int = 512

    @property
    def db_path(self) -> Path:
        return self.data_dir / "profiler.db"

    @property
    def variants_dir(self) -> Path:
        return self.data_dir / "variants"


settings = Settings()

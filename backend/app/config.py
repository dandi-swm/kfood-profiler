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

    # Vertex AI(ADC) 경로: GCP 무료 크레딧을 쓰려면 .env에
    #   USE_VERTEXAI=true
    #   GOOGLE_CLOUD_PROJECT=<프로젝트 ID>
    # 를 설정 (사전 준비: gcloud auth application-default login)
    use_vertexai: bool = False
    google_cloud_project: str = ""
    google_cloud_location: str = "global"

    # 샘플러 자격 기준: 최장변이 이 값 미만인 이미지는 샘플에서 제외
    min_longest_side: int = 512

    @property
    def db_path(self) -> Path:
        return self.data_dir / "profiler.db"

    @property
    def variants_dir(self) -> Path:
        return self.data_dir / "variants"


settings = Settings()

"""테스트 픽스처: 임시 데이터셋(2클래스) + 임시 DB로 앱 구동.

모든 app 모듈이 config.settings 싱글턴을 공유하므로, 어떤 app 모듈보다
먼저 settings를 임시 경로로 바꾼 뒤 db/main을 임포트한다.
(테스트 파일에서는 app 모듈을 함수 안에서 늦게 임포트할 것)
"""

import unicodedata

import pytest
from PIL import Image


@pytest.fixture(scope="session")
def fake_dataset(tmp_path_factory):
    root = tmp_path_factory.mktemp("kfood")
    # macOS 실제 상황 재현: 디렉토리명을 NFD로 생성
    spec = {
        ("구이", "갈비구이"): 3,
        ("찌개", "김치찌개"): 3,
    }
    for (cat, cls), n in spec.items():
        d = root / unicodedata.normalize("NFD", cat) / unicodedata.normalize("NFD", cls)
        d.mkdir(parents=True)
        for i in range(n):
            img = Image.new("RGB", (800, 600), color=(i * 40 % 255, 100, 150))
            img.save(d / f"Img_000_{i:04d}.jpg", "JPEG", quality=90)
        # 자격 미달(작은) 이미지와 비이미지 파일도 섞어둔다
        Image.new("RGB", (300, 200), color=(1, 2, 3)).save(
            d / "Img_000_9999.jpg", "JPEG"
        )
        (d / "crop_area.properties").write_text("x=1\n")
    return root


@pytest.fixture(scope="session")
def test_env(fake_dataset, tmp_path_factory):
    from app.config import settings

    data_dir = tmp_path_factory.mktemp("data")
    settings.dataset_root = fake_dataset
    settings.data_dir = data_dir
    return settings


@pytest.fixture(scope="session")
def app_client(test_env):
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        yield client

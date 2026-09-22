"""같은 원본 이미지에서 해상도/압축 변형을 생성한다.

- original : 원본 파일 그대로 복사 (참조점; 실측 치수 기록)
- resize512: 최장변 512px LANCZOS 축소, JPEG q85
- resize256: 최장변 256px LANCZOS 축소, JPEG q85
- q85      : 원본 해상도 유지, JPEG q85 재인코딩
- q50      : 원본 해상도 유지, JPEG q50 재인코딩
"""

import shutil
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

VARIANT_TYPES = ["original", "resize512", "resize256", "q85", "q50"]


def _load_rgb(image_bytes: bytes) -> Image.Image:
    img = Image.open(BytesIO(image_bytes))
    img = ImageOps.exif_transpose(img)
    if img.mode != "RGB":
        img = img.convert("RGB")
    return img


def generate_variant(
    variant_type: str,
    src_path: Path,
    out_dir: Path,
) -> tuple[Path, int, int, int]:
    """변형 파일을 생성하고 (path, width, height, bytes)를 반환. 멱등."""
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / f"{variant_type}.jpg"

    if variant_type == "original":
        if not out_path.exists():
            shutil.copyfile(src_path, out_path)
        with Image.open(out_path) as img:
            w, h = img.size
        return out_path, w, h, out_path.stat().st_size

    if not out_path.exists():
        img = _load_rgb(src_path.read_bytes())
        if variant_type == "resize512":
            img.thumbnail((512, 512), Image.LANCZOS)
            img.save(out_path, "JPEG", quality=85)
        elif variant_type == "resize256":
            img.thumbnail((256, 256), Image.LANCZOS)
            img.save(out_path, "JPEG", quality=85)
        elif variant_type == "q85":
            img.save(out_path, "JPEG", quality=85)
        elif variant_type == "q50":
            img.save(out_path, "JPEG", quality=50)
        else:
            raise ValueError(f"unknown variant type: {variant_type}")

    with Image.open(out_path) as img:
        w, h = img.size
    return out_path, w, h, out_path.stat().st_size

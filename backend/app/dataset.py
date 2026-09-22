"""데이터셋 접근 레이어.

kfood 디렉토리 구조: <root>/<카테고리>/<음식클래스>/Img_XXX_YYYY.jpg
macOS(APFS)는 한글 디렉토리명을 NFD로 반환하므로 모든 라벨은 NFC로 정규화해서
다룬다. 디스크 접근 시에는 원래(NFD) 경로가 필요하므로 양쪽을 함께 보관한다.
"""

import os
import unicodedata
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from struct import unpack

IMAGE_EXTS = (".jpg", ".jpeg")


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


@dataclass(frozen=True)
class ClassInfo:
    label: str  # NFC
    category: str  # NFC
    image_count: int


def read_jpeg_dimensions(path: str | Path) -> tuple[int, int] | None:
    """전체 디코딩 없이 JPEG SOF 마커에서 (width, height)를 읽는다."""
    try:
        with open(path, "rb") as f:
            data = f.read(65536)
    except OSError:
        return None
    if len(data) < 4 or data[:2] != b"\xff\xd8":
        return None
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3):
            h, w = unpack(">HH", data[i + 5 : i + 9])
            return w, h
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        if i + 4 > len(data):
            break
        i += 2 + unpack(">H", data[i + 2 : i + 4])[0]
    return None


class DatasetSource(ABC):
    @abstractmethod
    def scan_classes(self) -> list[ClassInfo]: ...

    @abstractmethod
    def list_images(self, class_label: str) -> list[str]:
        """클래스의 이미지 rel_path 목록 (정렬됨, NFC)."""

    @abstractmethod
    def abs_path(self, rel_path: str) -> Path:
        """rel_path(NFC)를 실제 디스크 경로로 변환."""

    def read_bytes(self, rel_path: str) -> bytes:
        return self.abs_path(rel_path).read_bytes()


class FsDatasetSource(DatasetSource):
    def __init__(self, root: Path):
        self.root = Path(root)
        # NFC rel_path → 실제(디스크 그대로) rel_path
        self._path_map: dict[str, str] = {}
        # NFC class label → (category, [NFC rel_path...])
        self._classes: dict[str, tuple[str, list[str]]] = {}
        self._scanned = False

    def _scan(self) -> None:
        if self._scanned:
            return
        for cat in sorted(os.scandir(self.root), key=lambda e: e.name):
            if not cat.is_dir() or cat.name.startswith("."):
                continue
            cat_nfc = nfc(cat.name)
            for cls in sorted(os.scandir(cat.path), key=lambda e: e.name):
                if not cls.is_dir() or cls.name.startswith("."):
                    continue
                cls_nfc = nfc(cls.name)
                rel_paths = []
                for f in sorted(os.scandir(cls.path), key=lambda e: e.name):
                    if not f.is_file() or not f.name.lower().endswith(IMAGE_EXTS):
                        continue
                    raw_rel = f"{cat.name}/{cls.name}/{f.name}"
                    rel = nfc(raw_rel)
                    self._path_map[rel] = raw_rel
                    rel_paths.append(rel)
                if rel_paths:
                    self._classes[cls_nfc] = (cat_nfc, rel_paths)
        self._scanned = True

    def scan_classes(self) -> list[ClassInfo]:
        self._scan()
        return [
            ClassInfo(label=label, category=cat, image_count=len(paths))
            for label, (cat, paths) in sorted(self._classes.items())
        ]

    def list_images(self, class_label: str) -> list[str]:
        self._scan()
        entry = self._classes.get(nfc(class_label))
        return list(entry[1]) if entry else []

    def abs_path(self, rel_path: str) -> Path:
        self._scan()
        raw = self._path_map.get(nfc(rel_path), rel_path)
        return self.root / raw


_source: FsDatasetSource | None = None


def get_dataset_source() -> FsDatasetSource:
    global _source
    if _source is None:
        from .config import settings

        _source = FsDatasetSource(settings.dataset_root)
    return _source

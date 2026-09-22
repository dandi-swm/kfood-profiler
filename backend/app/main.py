import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .runner import recover_interrupted_runs
from .routers import dataset, images, manifests, models, results, runs

logging.basicConfig(level=logging.INFO)
# google-genai SDK가 호출마다 찍는 AFC INFO/WARNING 로그 억제 (동작과 무관한 소음)
logging.getLogger("google_genai.models").setLevel(logging.ERROR)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    recover_interrupted_runs()
    yield


app = FastAPI(title="K-Food AI Profiler", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(dataset.router)
app.include_router(models.router)
app.include_router(manifests.router)
app.include_router(runs.router)
app.include_router(results.router)
app.include_router(images.router)


@app.get("/api/health")
def health():
    return {"ok": True}

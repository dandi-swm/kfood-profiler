/**
 * 정적 리포트 모드 (VITE_STATIC=1): 백엔드 없이 내보낸 JSON(report-data/)을 읽어
 * 클라이언트에서 집계/필터링한다. GitHub Pages 배포용.
 */
import type {
  AggRow,
  ClassInfo,
  Manifest,
  ModelInfo,
  Prediction,
  PredictionPage,
  Progress,
  Run,
  VariantType,
} from './types'

import { IMG_FALLBACK } from './placeholder'

const BASE = `${import.meta.env.BASE_URL}report-data/`

// 이미지 디렉토리 포함 여부 (배포본은 라이선스상 이미지 제외 → 요청 없이 즉시 플레이스홀더)
let imagesAvailable = false

interface Meta {
  generated_at: string
  runs: Run[]
}

let metaPromise: Promise<Meta> | null = null
function loadMeta(): Promise<Meta> {
  metaPromise ??= (async () => {
    const [metaRes, imgOk] = await Promise.all([
      fetch(`${BASE}meta.json`),
      fetch(`${BASE}images/available.flag`).then((r) => r.ok).catch(() => false),
    ])
    if (!metaRes.ok) throw new Error(`meta.json 로드 실패 (${metaRes.status})`)
    imagesAvailable = imgOk
    return metaRes.json()
  })()
  return metaPromise
}

const predsCache = new Map<number, Promise<Prediction[]>>()
function loadPreds(runId: number): Promise<Prediction[]> {
  if (!predsCache.has(runId)) {
    predsCache.set(
      runId,
      fetch(`${BASE}predictions/${runId}.json`).then((r) => {
        if (!r.ok) throw new Error(`run ${runId} 데이터 로드 실패 (${r.status})`)
        return r.json()
      }),
    )
  }
  return predsCache.get(runId)!
}

function notAvailable(): never {
  throw new Error('정적 리포트 모드에서는 사용할 수 없는 기능입니다')
}

type Dim = 'run_id' | 'model_id' | 'class_label' | 'category' | 'variant_type'

export const staticApi = {
  classes: async (): Promise<ClassInfo[]> => [],
  models: async (): Promise<ModelInfo[]> => [],
  manifests: async (): Promise<Manifest[]> => [],
  manifest: notAvailable,
  createManifest: notAvailable,
  deleteManifest: notAvailable,

  runs: async (): Promise<Run[]> => (await loadMeta()).runs,
  run: async (id: number): Promise<Run> => {
    const run = (await loadMeta()).runs.find((r) => r.id === id)
    if (!run) throw new Error(`run ${id} 없음`)
    return run
  },
  createRun: notAvailable,
  cancelRun: notAvailable,
  deleteRun: notAvailable,
  resumeRun: notAvailable,
  progress: async (id: number): Promise<Progress> => {
    const run = (await loadMeta()).runs.find((r) => r.id === id)
    const preds = await loadPreds(id)
    const cost = preds.reduce((s, p) => s + (p.cost_usd ?? 0), 0)
    let elapsed: number | null = null
    if (run?.started_at && run.finished_at) {
      elapsed = (new Date(run.finished_at).getTime() - new Date(run.started_at).getTime()) / 1000
    }
    return {
      run_id: id,
      status: run?.status ?? 'completed',
      done: preds.length,
      errors: preds.filter((p) => p.status === 'error').length,
      total: run?.total_items ?? preds.length,
      elapsed_s: elapsed,
      est_cost_so_far: cost,
    }
  },

  aggregate: async (params: {
    run_ids: number[]
    group_by: string[]
    class_label?: string
    variant_type?: string
  }): Promise<AggRow[]> => {
    const meta = await loadMeta()
    const modelOf = new Map(meta.runs.map((r) => [r.id, r.model_id]))
    const dims = params.group_by.filter((g): g is Dim =>
      ['run_id', 'model_id', 'class_label', 'category', 'variant_type'].includes(g),
    )
    const all = (await Promise.all(params.run_ids.map(loadPreds))).flat()
    const rows = all.filter(
      (p) =>
        (!params.class_label || p.class_label === params.class_label) &&
        (!params.variant_type || p.variant_type === params.variant_type),
    )

    const groups = new Map<string, Prediction[]>()
    const keyValues = new Map<string, Record<string, string | number>>()
    for (const p of rows) {
      const kv: Record<string, string | number> = {}
      for (const d of dims) {
        kv[d] = d === 'model_id' ? (modelOf.get(p.run_id) ?? '') : (p[d] as string | number)
      }
      const key = dims.map((d) => String(kv[d])).join('|')
      if (!groups.has(key)) {
        groups.set(key, [])
        keyValues.set(key, kv)
      }
      groups.get(key)!.push(p)
    }

    const out: AggRow[] = []
    for (const [key, preds] of groups) {
      const graded = preds.filter((p) => p.is_correct !== null)
      const lats = preds.filter((p) => p.latency_ms !== null)
      out.push({
        ...(keyValues.get(key) as Partial<AggRow>),
        count: preds.length,
        errors: preds.filter((p) => p.status === 'error').length,
        accuracy: graded.length
          ? graded.reduce((s, p) => s + (p.is_correct ? 1 : 0), 0) / graded.length
          : null,
        avg_latency_ms: lats.length
          ? lats.reduce((s, p) => s + (p.latency_ms ?? 0), 0) / lats.length
          : null,
        input_tokens: preds.reduce((s, p) => s + (p.input_tokens ?? 0), 0),
        output_tokens: preds.reduce((s, p) => s + (p.output_tokens ?? 0), 0),
        cost_usd: preds.reduce((s, p) => s + (p.cost_usd ?? 0), 0),
      })
    }
    out.sort((a, b) => {
      for (const d of dims) {
        const av = String(a[d as keyof AggRow] ?? '')
        const bv = String(b[d as keyof AggRow] ?? '')
        if (av !== bv) return av < bv ? -1 : 1
      }
      return 0
    })
    return out
  },

  predictions: async (params: {
    run_id: number
    class_label?: string
    variant_type?: string
    is_correct?: boolean
    status?: string
    sample_id?: number
    page?: number
    page_size?: number
  }): Promise<PredictionPage> => {
    const preds = await loadPreds(params.run_id)
    const filtered = preds.filter(
      (p) =>
        (!params.class_label || p.class_label === params.class_label) &&
        (!params.variant_type || p.variant_type === params.variant_type) &&
        (params.is_correct === undefined || p.is_correct === params.is_correct) &&
        (!params.status || p.status === params.status) &&
        (!params.sample_id || p.sample_id === params.sample_id),
    )
    filtered.sort((a, b) => a.sample_id - b.sample_id || a.variant_id - b.variant_id)
    const page = params.page ?? 1
    const pageSize = params.page_size ?? 50
    return {
      items: filtered.slice((page - 1) * pageSize, page * pageSize),
      total: filtered.length,
      page,
      page_size: pageSize,
    }
  },
}

export function staticVariantImageUrl(variantId: number): string {
  return imagesAvailable ? `${BASE}images/variants/${variantId}.jpg` : IMG_FALLBACK
}

export function staticSampleImageUrl(sampleId: number): string {
  return imagesAvailable ? `${BASE}images/samples/${sampleId}.jpg` : IMG_FALLBACK
}

export type { VariantType }

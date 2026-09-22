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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const body = await res.text()
    let detail = body
    try {
      detail = JSON.parse(body).detail ?? body
    } catch {
      /* not json */
    }
    throw new Error(`${res.status}: ${detail}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  classes: () => request<ClassInfo[]>('/api/dataset/classes'),
  models: () => request<ModelInfo[]>('/api/models'),

  manifests: () => request<Manifest[]>('/api/manifests'),
  manifest: (id: number) => request<Manifest>(`/api/manifests/${id}`),
  createManifest: (body: {
    name: string
    seed: number
    per_class: number
    class_filter: string[] | null
  }) => request<Manifest>('/api/manifests', { method: 'POST', body: JSON.stringify(body) }),
  deleteManifest: (id: number) =>
    request<{ deleted: number }>(`/api/manifests/${id}`, { method: 'DELETE' }),

  runs: () => request<Run[]>('/api/runs'),
  run: (id: number) => request<Run>(`/api/runs/${id}`),
  createRun: (body: {
    name: string
    manifest_id: number
    model_id: string
    variant_types: VariantType[]
    concurrency: number
  }) => request<Run>('/api/runs', { method: 'POST', body: JSON.stringify(body) }),
  cancelRun: (id: number) => request(`/api/runs/${id}/cancel`, { method: 'POST' }),
  deleteRun: (id: number) =>
    request<{ deleted: number }>(`/api/runs/${id}`, { method: 'DELETE' }),
  resumeRun: (id: number) => request<Run>(`/api/runs/${id}/resume`, { method: 'POST' }),
  progress: (id: number) => request<Progress>(`/api/runs/${id}/progress`),

  aggregate: (params: {
    run_ids: number[]
    group_by: string[]
    class_label?: string
    variant_type?: string
  }) => {
    const q = new URLSearchParams({
      run_ids: params.run_ids.join(','),
      group_by: params.group_by.join(','),
    })
    if (params.class_label) q.set('class_label', params.class_label)
    if (params.variant_type) q.set('variant_type', params.variant_type)
    return request<AggRow[]>(`/api/results/aggregate?${q}`)
  },

  predictions: (params: {
    run_id: number
    class_label?: string
    variant_type?: string
    is_correct?: boolean
    status?: string
    sample_id?: number
    page?: number
    page_size?: number
  }) => {
    const q = new URLSearchParams({ run_id: String(params.run_id) })
    if (params.class_label) q.set('class_label', params.class_label)
    if (params.variant_type) q.set('variant_type', params.variant_type)
    if (params.is_correct !== undefined) q.set('is_correct', String(params.is_correct))
    if (params.status) q.set('status', params.status)
    if (params.sample_id) q.set('sample_id', String(params.sample_id))
    if (params.page) q.set('page', String(params.page))
    if (params.page_size) q.set('page_size', String(params.page_size))
    return request<PredictionPage>(`/api/predictions?${q}`)
  },
}

export function variantImageUrl(variantId: number): string {
  return `/api/images/variants/${variantId}`
}

export type { Prediction }

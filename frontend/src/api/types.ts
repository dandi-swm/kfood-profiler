export interface ClassInfo {
  label: string
  category: string
  image_count: number
}

export interface ModelInfo {
  model_id: string
  provider: string
  display_name: string
  usd_per_m_input: number
  usd_per_m_output: number
  thinking: boolean
}

export type VariantType = 'original' | 'resize512' | 'resize256' | 'q85' | 'q50'
export const VARIANT_TYPES: VariantType[] = ['original', 'resize512', 'resize256', 'q85', 'q50']

export interface Manifest {
  id: number
  name: string
  seed: number
  per_class: number
  class_filter: string[] | null
  variant_types: VariantType[]
  status: 'creating' | 'ready' | 'failed'
  error: string | null
  created_at: string
  sample_count: number
  class_count: number
}

export interface Run {
  id: number
  name: string
  manifest_id: number
  model_id: string
  provider: string
  api_path: string
  prompt_version: string
  variant_types: VariantType[]
  concurrency: number
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed'
  total_items: number
  started_at: string | null
  finished_at: string | null
  error: string | null
  created_at: string
}

export interface Progress {
  run_id: number
  status: Run['status']
  done: number
  errors: number
  total: number
  elapsed_s: number | null
  est_cost_so_far: number
}

export interface AggRow {
  run_id?: number
  model_id?: string
  class_label?: string
  category?: string
  variant_type?: VariantType
  count: number
  errors: number
  accuracy: number | null
  avg_latency_ms: number | null
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface Prediction {
  id: number
  run_id: number
  variant_id: number
  sample_id: number
  class_label: string
  category: string
  variant_type: VariantType
  width: number
  height: number
  bytes: number
  status: 'ok' | 'error'
  raw_response: string | null
  predicted_label: string | null
  is_correct: boolean | null
  latency_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  cost_usd: number | null
  error: string | null
}

export interface PredictionPage {
  items: Prediction[]
  total: number
  page: number
  page_size: number
}

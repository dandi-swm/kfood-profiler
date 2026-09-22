import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { api, onImgError, sampleImageUrl, variantImageUrl } from '../api/client'
import type { Prediction } from '../api/types'
import { VARIANT_TYPES } from '../api/types'

function PredictionCard({ p, onCompare }: { p: Prediction; onCompare: (sampleId: number) => void }) {
  return (
    <div className="pred-card">
      <img src={variantImageUrl(p.variant_id)} alt={p.class_label} loading="lazy" data-fallback={sampleImageUrl(p.sample_id)} onError={onImgError} />
      <div className="meta">
        <div className="labels">
          정답 <strong>{p.class_label}</strong>
          {' → '}
          예측 <strong>{p.predicted_label ?? '–'}</strong>{' '}
          {p.status === 'error' ? (
            <span className="badge error">에러</span>
          ) : (
            <span className={`badge ${p.is_correct ? 'correct' : 'wrong'}`}>
              {p.is_correct ? '정답' : '오답'}
            </span>
          )}
        </div>
        <div className="muted">
          {p.variant_type} · {p.width}×{p.height} · {(p.bytes / 1024).toFixed(0)}KB
          {p.latency_ms != null && ` · ${p.latency_ms}ms`}
          {p.input_tokens != null && ` · ${p.input_tokens}tok`}
        </div>
        {p.error && <div className="error-text">{p.error}</div>}
        {p.raw_response && p.raw_response !== p.predicted_label && (
          <details>
            <summary>raw 응답</summary>
            <pre>{p.raw_response}</pre>
          </details>
        )}
        <button className="secondary" style={{ marginTop: 6, fontSize: 12, padding: '4px 10px' }}
          onClick={() => onCompare(p.sample_id)}>
          이 사진의 변형 비교
        </button>
      </div>
    </div>
  )
}

function VariantStrip({ runId, sampleId }: { runId: number; sampleId: number }) {
  const { data } = useQuery({
    queryKey: ['strip', runId, sampleId],
    queryFn: () => api.predictions({ run_id: runId, sample_id: sampleId, page_size: 10 }),
  })
  if (!data) return null
  const ordered = [...data.items].sort(
    (a, b) => VARIANT_TYPES.indexOf(a.variant_type) - VARIANT_TYPES.indexOf(b.variant_type),
  )
  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>
        같은 사진 변형 비교 — {ordered[0]?.class_label} (sample #{sampleId})
      </h3>
      <div className="variant-strip">
        {ordered.map((p) => (
          <div className="vs-item" key={p.id}>
            <img src={variantImageUrl(p.variant_id)} alt={p.variant_type} data-fallback={sampleImageUrl(p.sample_id)} onError={onImgError} />
            <div>
              <strong>{p.variant_type}</strong> {p.width}×{p.height} · {(p.bytes / 1024).toFixed(0)}KB
            </div>
            <div>
              예측: {p.predicted_label ?? '–'}{' '}
              <span className={`badge ${p.is_correct ? 'correct' : 'wrong'}`}>
                {p.is_correct ? '정답' : '오답'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function PredictionsPage() {
  const [params, setParams] = useSearchParams()
  const { data: runs } = useQuery({ queryKey: ['runs'], queryFn: api.runs })

  const runId = params.get('run_id') ? +params.get('run_id')! : undefined
  const classLabel = params.get('class_label') ?? ''
  const variantType = params.get('variant_type') ?? ''
  const correctness = params.get('is_correct') ?? ''
  const page = params.get('page') ? +params.get('page')! : 1
  const [compareSample, setCompareSample] = useState<number | null>(null)

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setParams(next)
  }

  const { data: classAgg } = useQuery({
    queryKey: ['agg-class-for-filter', runId],
    queryFn: () => api.aggregate({ run_ids: [runId!], group_by: ['class_label'] }),
    enabled: !!runId,
  })

  const { data } = useQuery({
    queryKey: ['preds', runId, classLabel, variantType, correctness, page],
    queryFn: () =>
      api.predictions({
        run_id: runId!,
        class_label: classLabel || undefined,
        variant_type: variantType || undefined,
        is_correct: correctness === '' ? undefined : correctness === 'true',
        page,
        page_size: 24,
      }),
    enabled: !!runId,
  })

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div>
      <h2>예측 드릴다운</h2>
      <div className="card">
        <div className="form-row">
          <div>
            <label>Run</label>
            <select value={runId ?? ''} onChange={(e) => setParam('run_id', e.target.value)}>
              <option value="">선택…</option>
              {runs?.map((r) => (
                <option key={r.id} value={r.id}>#{r.id} {r.name} ({r.model_id})</option>
              ))}
            </select>
          </div>
          <div>
            <label>클래스</label>
            <select value={classLabel} onChange={(e) => setParam('class_label', e.target.value)}>
              <option value="">전체</option>
              {classAgg?.map((c) => (
                <option key={c.class_label} value={c.class_label}>{c.class_label}</option>
              ))}
            </select>
          </div>
          <div>
            <label>변형</label>
            <select value={variantType} onChange={(e) => setParam('variant_type', e.target.value)}>
              <option value="">전체</option>
              {VARIANT_TYPES.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label>정오</label>
            <select value={correctness} onChange={(e) => setParam('is_correct', e.target.value)}>
              <option value="">전체</option>
              <option value="true">정답만</option>
              <option value="false">오답만</option>
            </select>
          </div>
        </div>
        {data && <span className="muted">{data.total.toLocaleString()}건</span>}
      </div>

      {compareSample && runId && <VariantStrip runId={runId} sampleId={compareSample} />}

      {!runId && <p className="muted">run을 선택하세요.</p>}
      <div className="grid">
        {data?.items.map((p) => (
          <PredictionCard key={p.id} p={p} onCompare={setCompareSample} />
        ))}
      </div>

      {data && totalPages > 1 && (
        <div style={{ marginTop: 16, display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="secondary" disabled={page <= 1}
            onClick={() => setParam('page', String(page - 1))}>이전</button>
          <span className="muted">{page} / {totalPages}</span>
          <button className="secondary" disabled={page >= totalPages}
            onClick={() => setParam('page', String(page + 1))}>다음</button>
        </div>
      )}
    </div>
  )
}

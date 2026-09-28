import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import {
  MEDIA_RES_IMAGE_TOKENS, VARIANT_TYPES, type MediaResolution, type Run, type VariantType,
} from '../api/types'
import ProgressBar from '../components/ProgressBar'

function RunRow({ run }: { run: Run }) {
  const qc = useQueryClient()
  const active = run.status === 'running' || run.status === 'pending'
  const { data: progress } = useQuery({
    queryKey: ['progress', run.id],
    queryFn: () => api.progress(run.id),
    refetchInterval: active ? 1500 : false,
  })
  const cancel = useMutation({
    mutationFn: () => api.cancelRun(run.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
  const resume = useMutation({
    mutationFn: () => api.resumeRun(run.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })
  const remove = useMutation({
    mutationFn: () => api.deleteRun(run.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['runs'] }),
  })

  const status = progress?.status ?? run.status
  const done = progress?.done ?? 0
  const pct = run.total_items ? Math.round((done / run.total_items) * 100) : 0
  const resumable =
    (status === 'failed' || status === 'cancelled') && done < run.total_items

  return (
    <tr>
      <td>{run.id}</td>
      <td>{run.name}</td>
      <td>
        {run.model_id}
        {run.provider === 'gemini' && (
          <div className="muted">
            {run.api_path === 'vertex' ? 'Vertex (크레딧)' : 'API 키'} · 해상도{' '}
            {run.media_resolution ? run.media_resolution.toUpperCase() : '기본'}
          </div>
        )}
      </td>
      <td className="muted">{run.variant_types.join(', ')}</td>
      <td style={{ minWidth: 180 }}>
        <ProgressBar value={done} total={run.total_items} />
        <span className="progress-meta">
          {done.toLocaleString()}/{run.total_items.toLocaleString()} ({pct}%)
          {progress && progress.errors > 0 && (
            <span className="error-text"> 에러 {progress.errors}</span>
          )}
        </span>
      </td>
      <td>
        <span className={`badge ${status}`}>{status}</span>
        {run.error && <div className="error-text">{run.error}</div>}
      </td>
      <td className="muted">
        {progress?.elapsed_s != null && `${Math.round(progress.elapsed_s)}s`}
        {progress != null && progress.est_cost_so_far > 0 && (
          <div>${progress.est_cost_so_far.toFixed(4)}</div>
        )}
      </td>
      <td>
        {active && (
          <button className="danger tiny" onClick={() => cancel.mutate()}>취소</button>
        )}
        {resumable && (
          <button className="secondary tiny" onClick={() => resume.mutate()}>이어서 실행</button>
        )}
        {!active && (
          <button
            className="danger tiny"
            style={{ marginLeft: 6 }}
            onClick={() => {
              if (window.confirm(`run #${run.id} "${run.name}"과 예측 결과를 모두 삭제할까요?`))
                remove.mutate()
            }}
          >
            삭제
          </button>
        )}
      </td>
    </tr>
  )
}

export default function RunsPage() {
  const qc = useQueryClient()
  const { data: manifests } = useQuery({ queryKey: ['manifests'], queryFn: api.manifests })
  const { data: models } = useQuery({ queryKey: ['models'], queryFn: api.models })
  const { data: runs } = useQuery({
    queryKey: ['runs'],
    queryFn: api.runs,
    refetchInterval: (q) =>
      q.state.data?.some((r) => r.status === 'running' || r.status === 'pending') ? 2000 : false,
  })

  const readyManifests = manifests?.filter((m) => m.status === 'ready') ?? []
  const [name, setName] = useState('')
  const [manifestId, setManifestId] = useState<number | ''>('')
  const [modelId, setModelId] = useState('')
  const [variants, setVariants] = useState<Set<VariantType>>(new Set(VARIANT_TYPES))
  const [concurrency, setConcurrency] = useState(4)
  const [mediaRes, setMediaRes] = useState<MediaResolution | ''>('')

  const create = useMutation({
    mutationFn: api.createRun,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['runs'] })
      setName('')
    },
  })

  const manifest = readyManifests.find((m) => m.id === manifestId)
  const model = models?.find((m) => m.model_id === modelId)
  const calls = (manifest?.sample_count ?? 0) * variants.size
  const resApplies = !!model?.supports_media_resolution && mediaRes !== ''
  // 대략적 사전 추정 (실측 기반): 호출당 입력 = 텍스트 ~1,325토큰(프롬프트+enum 스키마)
  // + 이미지(media_resolution 고정값, 미지정=high 1,120). 출력은 thinking off ~10, on ~400
  const inTokens = 1325 + MEDIA_RES_IMAGE_TOKENS[resApplies ? (mediaRes as MediaResolution) : 'high']
  const outTokens = model?.thinking ? 400 : 10
  const estCost = model
    ? calls * (inTokens / 1e6 * model.usd_per_m_input + outTokens / 1e6 * model.usd_per_m_output)
    : 0

  const canLaunch = name && manifest && model && variants.size > 0

  const estimate = useMemo(() => {
    if (!manifest) return null
    return `${manifest.sample_count.toLocaleString()}샘플 × ${variants.size}변형 = ${calls.toLocaleString()}호출, 예상 비용 ≈ $${estCost.toFixed(2)}`
  }, [manifest, variants.size, calls, estCost])

  return (
    <div>
      <header className="page-head">
        <h1>테스트 실행</h1>
        <p className="page-sub">
          샘플셋 × 모델 × 변형을 골라 closed-set 분류를 돌립니다. 5개 변형이 모두 같은 사진에서
          나오므로, 변형 간 정확도 차이가 곧 해상도·압축의 순수 효과입니다.
        </p>
      </header>
      <div className="card">
        <h3>새 Run</h3>
        <div className="form-row">
          <div>
            <label>이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: flash-baseline" />
          </div>
          <div>
            <label>Manifest</label>
            <select value={manifestId} onChange={(e) => setManifestId(+e.target.value)}>
              <option value="">선택…</option>
              {readyManifests.map((m) => (
                <option key={m.id} value={m.id}>
                  #{m.id} {m.name} ({m.sample_count}샘플)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>모델</label>
            <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
              <option value="">선택…</option>
              {models?.map((m) => (
                <option key={m.model_id} value={m.model_id}>{m.display_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label>이미지 해상도 (media_resolution)</label>
            <select
              value={model?.supports_media_resolution ? mediaRes : ''}
              disabled={!model?.supports_media_resolution}
              title={model && !model.supports_media_resolution ? '이 모델은 지원하지 않습니다' : undefined}
              onChange={(e) => setMediaRes(e.target.value as MediaResolution | '')}
            >
              <option value="">{model && !model.supports_media_resolution ? '미지원 모델' : '기본 (= HIGH)'}</option>
              {(Object.keys(MEDIA_RES_IMAGE_TOKENS) as MediaResolution[]).map((r) => (
                <option key={r} value={r}>
                  {r.toUpperCase()} — 이미지 {MEDIA_RES_IMAGE_TOKENS[r].toLocaleString()}토큰
                </option>
              ))}
            </select>
          </div>
          <div>
            <label>동시성</label>
            <input type="number" min={1} max={32} value={concurrency} onChange={(e) => setConcurrency(+e.target.value)} />
          </div>
        </div>
        <div className="form-row">
          <div>
            <label>변형 선택</label>
            {VARIANT_TYPES.map((vt) => (
              <label key={vt} style={{ display: 'inline-block', marginRight: 12, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={variants.has(vt)}
                  onChange={(e) => {
                    const next = new Set(variants)
                    e.target.checked ? next.add(vt) : next.delete(vt)
                    setVariants(next)
                  }}
                />{' '}
                {vt}
              </label>
            ))}
          </div>
          <button
            disabled={!canLaunch || create.isPending}
            onClick={() =>
              create.mutate({
                name,
                manifest_id: manifestId as number,
                model_id: modelId,
                variant_types: [...variants],
                concurrency,
                media_resolution: resApplies ? (mediaRes as MediaResolution) : null,
              })
            }
          >
            실행
          </button>
        </div>
        {estimate && <p className="muted">{estimate}</p>}
        {create.isError && <div className="error-text">{(create.error as Error).message}</div>}
      </div>

      <div className="card">
        <h3>Run 목록</h3>
        <div className="scroll-y" style={{ maxHeight: 480 }}>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>이름</th><th>모델</th><th>변형</th>
              <th>진행률</th><th>상태</th><th>시간/비용</th><th></th>
            </tr>
          </thead>
          <tbody>
            {runs?.map((r) => <RunRow key={r.id} run={r} />)}
            {!runs?.length && (
              <tr><td colSpan={8} className="muted">아직 없습니다.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import { VARIANT_TYPES, type Run, type VariantType } from '../api/types'
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
          <div className="muted">{run.api_path === 'vertex' ? 'Vertex (크레딧)' : 'API 키'}</div>
        )}
      </td>
      <td className="muted">{run.variant_types.join(', ')}</td>
      <td style={{ minWidth: 180 }}>
        <ProgressBar value={done} total={run.total_items} />
        <span className="muted">
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
          <button className="danger" onClick={() => cancel.mutate()}>취소</button>
        )}
        {resumable && (
          <button className="secondary" onClick={() => resume.mutate()}>이어서 실행</button>
        )}
        {!active && (
          <button
            className="danger"
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
  // 대략적 사전 추정 (실측 기반): 호출당 입력 ~1.8k 토큰(클래스 목록+이미지),
  // 출력은 thinking off ~10토큰, thinking on ~400토큰(답변+thinking)
  const outTokens = model?.thinking ? 400 : 10
  const estCost = model
    ? calls * (1800 / 1e6 * model.usd_per_m_input + outTokens / 1e6 * model.usd_per_m_output)
    : 0

  const canLaunch = name && manifest && model && variants.size > 0

  const estimate = useMemo(() => {
    if (!manifest) return null
    return `${manifest.sample_count.toLocaleString()}샘플 × ${variants.size}변형 = ${calls.toLocaleString()}호출, 예상 비용 ≈ $${estCost.toFixed(2)}`
  }, [manifest, variants.size, calls, estCost])

  return (
    <div>
      <h2>테스트 실행</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>새 Run</h3>
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
        <h3 style={{ marginTop: 0 }}>Run 목록</h3>
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
  )
}

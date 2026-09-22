import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api } from '../api/client'
import type { AggRow } from '../api/types'
import { VARIANT_TYPES } from '../api/types'

const COLORS = ['#4353ff', '#ff8b3d', '#18a17c', '#c542c5', '#e0b400', '#6b7280']

function pct(v: number | null | undefined): string {
  return v == null ? '–' : `${(v * 100).toFixed(1)}%`
}

export default function DashboardPage() {
  const navigate = useNavigate()
  const { data: runs } = useQuery({ queryKey: ['runs'], queryFn: api.runs })
  const doneRuns = useMemo(
    () => runs?.filter((r) => ['completed', 'cancelled', 'failed'].includes(r.status)) ?? [],
    [runs],
  )
  const [selectedRuns, setSelectedRuns] = useState<number[]>([])
  const effective = selectedRuns.length ? selectedRuns : doneRuns.slice(0, 1).map((r) => r.id)

  const runName = (id: number) => {
    const r = runs?.find((x) => x.id === id)
    return r ? `#${r.id} ${r.name} (${r.model_id})` : `#${id}`
  }

  const { data: byVariant } = useQuery({
    queryKey: ['agg-variant', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['run_id', 'variant_type'] }),
    enabled: effective.length > 0,
  })
  const { data: byClass } = useQuery({
    queryKey: ['agg-class', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['class_label'] }),
    enabled: effective.length > 0,
  })
  const { data: matrix } = useQuery({
    queryKey: ['agg-matrix', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['class_label', 'variant_type'] }),
    enabled: effective.length > 0,
  })
  const { data: byModel } = useQuery({
    queryKey: ['agg-model', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['model_id'] }),
    enabled: effective.length > 0,
  })
  const { data: totals } = useQuery({
    queryKey: ['agg-total', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: [] }),
    enabled: effective.length > 0,
  })

  // 변형별 차트 데이터: run별 시리즈
  const variantChart = useMemo(() => {
    if (!byVariant) return []
    return VARIANT_TYPES.map((vt) => {
      const row: Record<string, string | number> = { variant: vt }
      effective.forEach((rid) => {
        const found = byVariant.find((r) => r.run_id === rid && r.variant_type === vt)
        if (found?.accuracy != null) row[runName(rid)] = +(found.accuracy * 100).toFixed(1)
      })
      return row
    }).filter((r) => Object.keys(r).length > 1)
  }, [byVariant, effective, runs])

  const latencyChart = useMemo(() => {
    if (!byVariant) return []
    return VARIANT_TYPES.map((vt) => {
      const row: Record<string, string | number> = { variant: vt }
      effective.forEach((rid) => {
        const found = byVariant.find((r) => r.run_id === rid && r.variant_type === vt)
        if (found?.avg_latency_ms != null) row[runName(rid)] = Math.round(found.avg_latency_ms)
      })
      return row
    }).filter((r) => Object.keys(r).length > 1)
  }, [byVariant, effective, runs])

  const classChart = useMemo(() => {
    if (!byClass) return []
    return [...byClass]
      .filter((r) => r.accuracy != null)
      .sort((a, b) => (a.accuracy! - b.accuracy!))
      .map((r) => ({ label: r.class_label!, accuracy: +((r.accuracy ?? 0) * 100).toFixed(1) }))
  }, [byClass])

  const matrixData = useMemo(() => {
    if (!matrix) return { classes: [] as string[], get: (_c: string, _v: string) => undefined as AggRow | undefined }
    const map = new Map<string, AggRow>()
    matrix.forEach((r) => map.set(`${r.class_label}|${r.variant_type}`, r))
    const classes = [...new Set(matrix.map((r) => r.class_label!))].sort()
    return { classes, get: (c: string, v: string) => map.get(`${c}|${v}`) }
  }, [matrix])

  const total = totals?.[0]

  return (
    <div>
      <h2>프로파일링 대시보드</h2>

      <div className="card">
        <label>비교할 Run (다중 선택)</label>
        <div>
          {doneRuns.map((r) => (
            <label key={r.id} style={{ display: 'inline-block', marginRight: 14, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={effective.includes(r.id)}
                onChange={(e) => {
                  const next = e.target.checked
                    ? [...effective, r.id]
                    : effective.filter((x) => x !== r.id)
                  setSelectedRuns(next)
                }}
              />{' '}
              #{r.id} {r.name} <span className="muted">({r.model_id})</span>
            </label>
          ))}
          {!doneRuns.length && <span className="muted">완료된 run이 아직 없습니다.</span>}
        </div>
      </div>

      {total && (
        <div className="tiles">
          <div className="tile"><div className="v">{pct(total.accuracy)}</div><div className="k">전체 정확도</div></div>
          <div className="tile"><div className="v">{total.count.toLocaleString()}</div><div className="k">예측 수</div></div>
          <div className="tile"><div className="v">{total.errors}</div><div className="k">에러</div></div>
          <div className="tile"><div className="v">{total.avg_latency_ms ? `${Math.round(total.avg_latency_ms)}ms` : '–'}</div><div className="k">평균 지연</div></div>
          <div className="tile"><div className="v">${total.cost_usd.toFixed(3)}</div><div className="k">비용</div></div>
        </div>
      )}

      {byModel && byModel.length > 0 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>모델별 요약 (선택 run 합산)</h3>
          <table>
            <thead>
              <tr>
                <th>모델</th><th>호출 수</th><th>정확도</th><th>평균 처리시간</th>
                <th>입력 토큰</th><th>출력 토큰</th><th>비용</th><th>호출당 비용</th>
              </tr>
            </thead>
            <tbody>
              {byModel.map((m) => (
                <tr key={m.model_id}>
                  <td>{m.model_id}</td>
                  <td>{m.count.toLocaleString()}</td>
                  <td>{pct(m.accuracy)}</td>
                  <td>{m.avg_latency_ms != null ? `${Math.round(m.avg_latency_ms)}ms` : '–'}</td>
                  <td>{m.input_tokens.toLocaleString()}</td>
                  <td>{m.output_tokens.toLocaleString()}</td>
                  <td><strong>${m.cost_usd.toFixed(3)}</strong></td>
                  <td>${m.count ? (m.cost_usd / m.count).toFixed(5) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>변형(해상도/압축)별 정확도 — 같은 사진 기준</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={variantChart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="variant" />
            <YAxis unit="%" domain={[0, 100]} />
            <Tooltip />
            <Legend />
            {effective.map((rid, i) => (
              <Bar key={rid} dataKey={runName(rid)} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>원본 대비 상대 성능</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          같은 사진들의 original 결과를 100% 기준으로, 각 변형이 상대적으로 얼마나 나빠지는지 / 얼마나 빨라지는지.
        </p>
        {effective.map((rid) => {
          const rows = byVariant?.filter((r) => r.run_id === rid) ?? []
          const base = rows.find((r) => r.variant_type === 'original')
          if (!rows.length) return null
          return (
            <div key={rid} style={{ marginBottom: 18 }}>
              <strong style={{ fontSize: 13 }}>{runName(rid)}</strong>
              {!base && (
                <span className="muted"> — original 변형이 없어 상대 비교 불가</span>
              )}
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>변형</th>
                    <th>정확도</th>
                    <th>원본 대비</th>
                    <th>하락폭</th>
                    <th>평균 처리시간</th>
                    <th>처리시간 배율</th>
                  </tr>
                </thead>
                <tbody>
                  {VARIANT_TYPES.map((vt) => {
                    const r = rows.find((x) => x.variant_type === vt)
                    if (!r) return null
                    const isBase = vt === 'original'
                    const acc = r.accuracy
                    const rel =
                      base?.accuracy != null && base.accuracy > 0 && acc != null
                        ? (acc / base.accuracy) * 100
                        : null
                    const dp =
                      base?.accuracy != null && acc != null
                        ? (acc - base.accuracy) * 100
                        : null
                    const latRatio =
                      base?.avg_latency_ms != null && base.avg_latency_ms > 0 && r.avg_latency_ms != null
                        ? r.avg_latency_ms / base.avg_latency_ms
                        : null
                    const dpColor = dp == null || isBase ? '#889' : dp < -1 ? '#c22' : dp > 1 ? '#147a3d' : '#889'
                    return (
                      <tr key={vt}>
                        <td>{vt}{isBase && <span className="muted"> (기준)</span>}</td>
                        <td>{pct(acc)}</td>
                        <td>{isBase ? '100%' : rel != null ? `${rel.toFixed(1)}%` : '–'}</td>
                        <td style={{ color: dpColor, fontWeight: isBase ? 400 : 600 }}>
                          {isBase ? '–' : dp != null ? `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%p` : '–'}
                        </td>
                        <td>{r.avg_latency_ms != null ? `${Math.round(r.avg_latency_ms)}ms` : '–'}</td>
                        <td>
                          {isBase ? '×1.00' : latRatio != null ? `×${latRatio.toFixed(2)}` : '–'}
                          {!isBase && latRatio != null && latRatio < 0.95 && (
                            <span style={{ color: '#147a3d' }}> (빠름)</span>
                          )}
                          {!isBase && latRatio != null && latRatio > 1.05 && (
                            <span style={{ color: '#c22' }}> (느림)</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>변형별 평균 처리시간 (ms)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={latencyChart}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="variant" />
            <YAxis unit="ms" />
            <Tooltip />
            <Legend />
            {effective.map((rid, i) => (
              <Bar key={rid} dataKey={runName(rid)} fill={COLORS[i % COLORS.length]} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>클래스별 정확도 (낮은 순, 선택 run 합산)</h3>
        <div style={{ overflowX: 'auto' }}>
          <ResponsiveContainer width="100%" height={Math.max(260, classChart.length * 16)}>
            <BarChart data={classChart} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" unit="%" domain={[0, 100]} />
              <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="accuracy" fill="#4353ff" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>클래스 × 변형 매트릭스 (셀 클릭 → 드릴다운)</h3>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>클래스</th>
                {VARIANT_TYPES.map((v) => <th key={v}>{v}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrixData.classes.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  {VARIANT_TYPES.map((v) => {
                    const cell = matrixData.get(c, v)
                    const acc = cell?.accuracy
                    const bg = acc == null ? undefined
                      : `rgba(67, 83, 255, ${0.08 + 0.5 * (1 - acc)})`
                    return (
                      <td
                        key={v}
                        className="matrix-cell"
                        style={{ background: bg }}
                        title="클릭하면 해당 예측들을 봅니다"
                        onClick={() =>
                          navigate(
                            `/predictions?run_id=${effective[0]}&class_label=${encodeURIComponent(c)}&variant_type=${v}`,
                          )
                        }
                      >
                        {pct(acc)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">배경이 진할수록 정확도가 낮은 셀입니다. 매트릭스는 선택된 run들의 합산입니다.</p>
      </div>
    </div>
  )
}

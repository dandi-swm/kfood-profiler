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

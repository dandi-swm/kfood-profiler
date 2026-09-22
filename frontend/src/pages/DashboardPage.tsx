import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, variantImageUrl } from '../api/client'
import type { AggRow, VariantType } from '../api/types'
import { VARIANT_TYPES } from '../api/types'

const COLORS = ['#4353ff', '#ff8b3d']

// 카테고리 도넛용 검증된 categorical 팔레트 (7색 + 기타는 회색)
const PIE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']
const PIE_OTHER = '#9a9a94'

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
  const [showAllMatrix, setShowAllMatrix] = useState(false)
  const [dialogCell, setDialogCell] = useState<{ cls: string; vt: VariantType } | null>(null)
  const effective = selectedRuns.length ? selectedRuns : doneRuns.slice(0, 1).map((r) => r.id)
  const isCompare = effective.length === 2

  const runName = (id: number) => {
    const r = runs?.find((x) => x.id === id)
    return r
      ? `#${r.id} ${r.name} (${r.model_id}${r.provider === 'gemini' && r.api_path ? `, ${r.api_path}` : ''})`
      : `#${id}`
  }

  const toggleRun = (id: number, checked: boolean) => {
    if (checked) {
      if (effective.length >= 2) return // 최대 2개
      setSelectedRuns([...effective, id])
    } else {
      setSelectedRuns(effective.filter((x) => x !== id))
    }
  }

  const { data: byRun } = useQuery({
    queryKey: ['agg-run', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['run_id'] }),
    enabled: effective.length > 0,
  })
  const { data: byVariant } = useQuery({
    queryKey: ['agg-variant', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['run_id', 'variant_type'] }),
    enabled: effective.length > 0,
  })
  const { data: byClass } = useQuery({
    queryKey: ['agg-class', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['run_id', 'class_label'] }),
    enabled: effective.length > 0,
  })
  const { data: byCategory } = useQuery({
    queryKey: ['agg-category', effective],
    queryFn: () => api.aggregate({ run_ids: effective, group_by: ['run_id', 'category'] }),
    enabled: effective.length > 0,
  })
  const { data: matrix } = useQuery({
    queryKey: ['agg-matrix', effective],
    queryFn: () =>
      api.aggregate({ run_ids: effective, group_by: ['run_id', 'class_label', 'variant_type'] }),
    enabled: effective.length > 0,
  })

  const runTotal = (rid: number) => byRun?.find((r) => r.run_id === rid)

  // 변형별 차트: run별 시리즈
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

  // 클래스별: run별 시리즈. 비교 모드에선 두 run 차이가 큰 순으로 정렬
  const classChart = useMemo(() => {
    if (!byClass) return []
    const labels = [...new Set(byClass.map((r) => r.class_label!))]
    const rows = labels.map((label) => {
      const row: Record<string, string | number> = { label }
      const accs: number[] = []
      effective.forEach((rid) => {
        const found = byClass.find((r) => r.run_id === rid && r.class_label === label)
        if (found?.accuracy != null) {
          row[runName(rid)] = +(found.accuracy * 100).toFixed(1)
          accs.push(found.accuracy)
        }
      })
      row.__sort = isCompare && accs.length === 2 ? -Math.abs(accs[0] - accs[1]) : (accs[0] ?? 0)
      return row
    })
    rows.sort((a, b) => (a.__sort as number) - (b.__sort as number))
    return rows
  }, [byClass, effective, runs, isCompare])

  const matrixData = useMemo(() => {
    if (!matrix)
      return {
        classes: [] as string[],
        get: (_r: number, _c: string, _v: string) => undefined as AggRow | undefined,
      }
    const map = new Map<string, AggRow>()
    matrix.forEach((r) => map.set(`${r.run_id}|${r.class_label}|${r.variant_type}`, r))
    const classes = [...new Set(matrix.map((r) => r.class_label!))].sort()
    return {
      classes,
      get: (rid: number, c: string, v: string) => map.get(`${rid}|${c}|${v}`),
    }
  }, [matrix])

  // 매트릭스: 오답/에러가 하나라도 있는 클래스만 (전체 보기 토글 가능)
  const matrixClasses = useMemo(() => {
    if (showAllMatrix) return matrixData.classes
    return matrixData.classes.filter((c) =>
      effective.some((rid) =>
        VARIANT_TYPES.some((v) => {
          const cell = matrixData.get(rid, c, v)
          return cell != null && ((cell.accuracy != null && cell.accuracy < 1) || cell.errors > 0)
        }),
      ),
    )
  }, [matrixData, effective, showAllMatrix])

  // run별 오답 카테고리 분포: 상위 7개 + 기타 (도넛)
  const wrongPies = useMemo(() => {
    if (!byCategory) return []
    return effective.map((rid) => {
      const rows = byCategory
        .filter((r) => r.run_id === rid)
        .map((r) => {
          const ok = r.count - r.errors
          const correct = Math.round(ok * (r.accuracy ?? 0))
          return { category: r.category!, wrong: ok - correct }
        })
        .filter((r) => r.wrong > 0)
        .sort((a, b) => b.wrong - a.wrong)
      const top = rows.slice(0, 7)
      const rest = rows.slice(7).reduce((s, r) => s + r.wrong, 0)
      const data = [
        ...top.map((r, i) => ({ name: r.category, value: r.wrong, fill: PIE_COLORS[i] })),
        ...(rest > 0 ? [{ name: '기타', value: rest, fill: PIE_OTHER }] : []),
      ]
      const total = data.reduce((s, d) => s + d.value, 0)
      return { rid, data, total }
    })
  }, [byCategory, effective])

  const { data: dialogPredsA } = useQuery({
    queryKey: ['dialog-preds', effective[0], dialogCell],
    queryFn: () =>
      api.predictions({
        run_id: effective[0],
        class_label: dialogCell!.cls,
        variant_type: dialogCell!.vt,
        page_size: 200,
      }),
    enabled: dialogCell != null && effective.length > 0,
  })
  const { data: dialogPredsB } = useQuery({
    queryKey: ['dialog-preds', effective[1], dialogCell],
    queryFn: () =>
      api.predictions({
        run_id: effective[1],
        class_label: dialogCell!.cls,
        variant_type: dialogCell!.vt,
        page_size: 200,
      }),
    enabled: dialogCell != null && isCompare,
  })

  const single = runTotal(effective[0])

  const diffCell = (a: number | null | undefined, b: number | null | undefined, unit: '%p' | 'ms' | '$') => {
    if (a == null || b == null) return '–'
    const d = unit === '%p' ? (a - b) * 100 : a - b
    const s = d > 0 ? '+' : ''
    const color = Math.abs(d) < 1e-9 ? '#889' : d > 0 ? '#4353ff' : '#ff8b3d'
    const text = unit === '%p' ? `${s}${d.toFixed(1)}%p` : unit === 'ms' ? `${s}${Math.round(d)}ms` : `${s}$${d.toFixed(3)}`
    return <span style={{ color, fontWeight: 600 }}>{text}</span>
  }

  return (
    <div>
      <h2>프로파일링 대시보드</h2>

      <div className="card">
        <label>비교할 Run (최대 2개 — 2개 선택 시 A/B 비교 모드)</label>
        <div>
          {doneRuns.map((r) => {
            const checked = effective.includes(r.id)
            const idx = effective.indexOf(r.id)
            return (
              <label
                key={r.id}
                style={{
                  display: 'inline-block', marginRight: 14, fontSize: 13,
                  opacity: !checked && effective.length >= 2 ? 0.4 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && effective.length >= 2}
                  onChange={(e) => toggleRun(r.id, e.target.checked)}
                />{' '}
                {checked && isCompare && (
                  <strong style={{ color: COLORS[idx] }}>{idx === 0 ? 'A ' : 'B '}</strong>
                )}
                #{r.id} {r.name} <span className="muted">({r.model_id})</span>
              </label>
            )
          })}
          {!doneRuns.length && <span className="muted">완료된 run이 아직 없습니다.</span>}
        </div>
      </div>

      {isCompare ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>A/B 비교 요약</h3>
          <table>
            <thead>
              <tr>
                <th>지표</th>
                <th style={{ color: COLORS[0] }}>A: {runName(effective[0])}</th>
                <th style={{ color: COLORS[1] }}>B: {runName(effective[1])}</th>
                <th>차이 (A−B)</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const a = runTotal(effective[0])
                const b = runTotal(effective[1])
                if (!a || !b) return null
                return (
                  <>
                    <tr>
                      <td>정확도</td>
                      <td>{pct(a.accuracy)}</td>
                      <td>{pct(b.accuracy)}</td>
                      <td>{diffCell(a.accuracy, b.accuracy, '%p')}</td>
                    </tr>
                    <tr>
                      <td>평균 처리시간</td>
                      <td>{a.avg_latency_ms != null ? `${Math.round(a.avg_latency_ms)}ms` : '–'}</td>
                      <td>{b.avg_latency_ms != null ? `${Math.round(b.avg_latency_ms)}ms` : '–'}</td>
                      <td>{diffCell(a.avg_latency_ms, b.avg_latency_ms, 'ms')}</td>
                    </tr>
                    <tr>
                      <td>총 비용</td>
                      <td>${a.cost_usd.toFixed(3)}</td>
                      <td>${b.cost_usd.toFixed(3)}</td>
                      <td>{diffCell(a.cost_usd, b.cost_usd, '$')}</td>
                    </tr>
                    <tr>
                      <td>호출당 비용</td>
                      <td>${a.count ? (a.cost_usd / a.count).toFixed(5) : '–'}</td>
                      <td>${b.count ? (b.cost_usd / b.count).toFixed(5) : '–'}</td>
                      <td></td>
                    </tr>
                    <tr>
                      <td>예측 수 / 에러</td>
                      <td>{a.count.toLocaleString()} / {a.errors}</td>
                      <td>{b.count.toLocaleString()} / {b.errors}</td>
                      <td></td>
                    </tr>
                  </>
                )
              })()}
            </tbody>
          </table>
        </div>
      ) : (
        single && (
          <div className="tiles">
            <div className="tile"><div className="v">{pct(single.accuracy)}</div><div className="k">정확도</div></div>
            <div className="tile"><div className="v">{single.count.toLocaleString()}</div><div className="k">예측 수</div></div>
            <div className="tile"><div className="v">{single.errors}</div><div className="k">에러</div></div>
            <div className="tile"><div className="v">{single.avg_latency_ms ? `${Math.round(single.avg_latency_ms)}ms` : '–'}</div><div className="k">평균 지연</div></div>
            <div className="tile"><div className="v">${single.cost_usd.toFixed(3)}</div><div className="k">비용</div></div>
            <div className="tile"><div className="v">${single.count ? (single.cost_usd / single.count).toFixed(5) : '–'}</div><div className="k">호출당 비용</div></div>
          </div>
        )
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
          같은 사진들의 original 결과를 100% 기준으로, 각 변형이 상대적으로 얼마나 나빠지는지 / 빨라지는지.
        </p>
        {effective.map((rid) => {
          const rows = byVariant?.filter((r) => r.run_id === rid) ?? []
          const base = rows.find((r) => r.variant_type === 'original')
          if (!rows.length) return null
          return (
            <div key={rid} style={{ marginBottom: 18 }}>
              <strong style={{ fontSize: 13, color: isCompare ? COLORS[effective.indexOf(rid)] : undefined }}>
                {isCompare ? (effective.indexOf(rid) === 0 ? 'A: ' : 'B: ') : ''}{runName(rid)}
              </strong>
              {!base && <span className="muted"> — original 변형이 없어 상대 비교 불가</span>}
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr>
                    <th>변형</th><th>정확도</th><th>원본 대비</th><th>하락폭</th>
                    <th>평균 처리시간</th><th>처리시간 배율</th>
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
                        ? (acc / base.accuracy) * 100 : null
                    const dp =
                      base?.accuracy != null && acc != null ? (acc - base.accuracy) * 100 : null
                    const latRatio =
                      base?.avg_latency_ms != null && base.avg_latency_ms > 0 && r.avg_latency_ms != null
                        ? r.avg_latency_ms / base.avg_latency_ms : null
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
                          {!isBase && latRatio != null && latRatio < 0.95 && <span style={{ color: '#147a3d' }}> (빠름)</span>}
                          {!isBase && latRatio != null && latRatio > 1.05 && <span style={{ color: '#c22' }}> (느림)</span>}
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
        <h3 style={{ marginTop: 0 }}>
          클래스별 정확도 {isCompare ? '(A/B 차이 큰 순)' : '(낮은 순)'}
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <ResponsiveContainer width="100%" height={Math.max(260, classChart.length * (isCompare ? 30 : 16))}>
            <BarChart data={classChart} layout="vertical" margin={{ left: 60 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" unit="%" domain={[0, 100]} />
              <YAxis type="category" dataKey="label" width={90} tick={{ fontSize: 11 }} />
              <Tooltip />
              {isCompare && <Legend />}
              {effective.map((rid, i) => (
                <Bar key={rid} dataKey={runName(rid)} fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>오답의 카테고리 분포</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          틀린 예측들이 어떤 음식 카테고리에서 나왔는지 (오답 많은 상위 7개 + 기타).
        </p>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {wrongPies.map(({ rid, data, total }) => (
            <div key={rid} style={{ flex: '1 1 420px', minWidth: 380 }}>
              <strong style={{ fontSize: 13, color: isCompare ? COLORS[effective.indexOf(rid)] : undefined }}>
                {isCompare ? (effective.indexOf(rid) === 0 ? 'A: ' : 'B: ') : ''}{runName(rid)}
                <span className="muted"> — 오답 {total.toLocaleString()}건</span>
              </strong>
              {total === 0 ? (
                <p className="muted">오답이 없습니다.</p>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <ResponsiveContainer width="55%" height={260}>
                    <PieChart>
                      <Pie
                        data={data}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="45%"
                        outerRadius="80%"
                        stroke="#fff"
                        strokeWidth={2}
                      >
                        {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
                      </Pie>
                      <Tooltip
                        formatter={(v: number, name: string) =>
                          [`${v.toLocaleString()}건 (${((v / total) * 100).toFixed(1)}%)`, name]
                        }
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <table style={{ width: '45%', fontSize: 12 }}>
                    <thead><tr><th>카테고리</th><th>오답</th><th>비율</th></tr></thead>
                    <tbody>
                      {data.map((d) => (
                        <tr key={d.name}>
                          <td>
                            <span style={{
                              display: 'inline-block', width: 10, height: 10,
                              background: d.fill, borderRadius: 2, marginRight: 6,
                            }} />
                            {d.name}
                          </td>
                          <td>{d.value.toLocaleString()}</td>
                          <td>{((d.value / total) * 100).toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
        <p className="muted">
          주의: 카테고리별 샘플 수가 다르므로(클래스 수 × 클래스당 N) 비율이 크다고 그 카테고리가
          꼭 "더 어려운" 건 아닙니다 — 클래스별 정확도 차트와 함께 보세요.
        </p>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>
          클래스 × 변형 매트릭스 {isCompare && <span className="muted">— 셀: A / B</span>} (셀 클릭 → 오답 드릴다운)
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          기본으로 오답/에러가 있는 클래스만 표시됩니다 ({matrixClasses.length}/{matrixData.classes.length}개).{' '}
          <label style={{ display: 'inline' }}>
            <input
              type="checkbox"
              checked={showAllMatrix}
              onChange={(e) => setShowAllMatrix(e.target.checked)}
            />{' '}
            전체 클래스 보기
          </label>
        </p>
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>클래스</th>
                {VARIANT_TYPES.map((v) => <th key={v}>{v}</th>)}
              </tr>
            </thead>
            <tbody>
              {matrixClasses.map((c) => (
                <tr key={c}>
                  <td>{c}</td>
                  {VARIANT_TYPES.map((v) => {
                    const cellA = matrixData.get(effective[0], c, v)
                    const cellB = isCompare ? matrixData.get(effective[1], c, v) : undefined
                    const accA = cellA?.accuracy
                    const accB = cellB?.accuracy
                    let bg: string | undefined
                    if (isCompare && accA != null && accB != null) {
                      const d = accA - accB
                      bg = d > 0.001
                        ? `rgba(67, 83, 255, ${Math.min(0.55, Math.abs(d))})`
                        : d < -0.001
                          ? `rgba(255, 139, 61, ${Math.min(0.55, Math.abs(d))})`
                          : undefined
                    } else if (accA != null) {
                      bg = `rgba(67, 83, 255, ${0.08 + 0.5 * (1 - accA)})`
                    }
                    return (
                      <td
                        key={v}
                        className="matrix-cell"
                        style={{ background: bg }}
                        title={isCompare ? 'A 기준 오답 드릴다운으로 이동' : '클릭하면 해당 셀의 오답들을 봅니다'}
                        onClick={() => setDialogCell({ cls: c, vt: v })}
                      >
                        {isCompare ? `${pct(accA)} / ${pct(accB)}` : pct(accA)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted">
          {isCompare
            ? '파란 셀 = A가 우세, 주황 셀 = B가 우세 (진할수록 차이 큼).'
            : '배경이 진할수록 정확도가 낮은 셀입니다.'}
        </p>
      </div>

      {dialogCell && (
        <div className="modal-overlay" onClick={() => setDialogCell(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {dialogCell.cls} × {dialogCell.vt}
              </h3>
              <button className="modal-close" onClick={() => setDialogCell(null)}>닫기 ✕</button>
            </div>
            {(() => {
              const itemsA = dialogPredsA?.items ?? []
              const bBySample = new Map(
                (dialogPredsB?.items ?? []).map((p) => [p.sample_id, p]),
              )
              if (!itemsA.length) return <p className="muted">불러오는 중…</p>
              // 오답(어느 한쪽이라도)을 위로
              const sorted = [...itemsA].sort((x, y) => {
                const xw = x.is_correct === false || bBySample.get(x.sample_id)?.is_correct === false ? 0 : 1
                const yw = y.is_correct === false || bBySample.get(y.sample_id)?.is_correct === false ? 0 : 1
                return xw - yw
              })
              const predBadge = (p?: { predicted_label: string | null; is_correct: boolean | null; status: string }) => {
                if (!p) return <span className="muted">–</span>
                if (p.status === 'error') return <span className="badge error">에러</span>
                return (
                  <>
                    <strong>{p.predicted_label ?? '–'}</strong>{' '}
                    <span className={`badge ${p.is_correct ? 'correct' : 'wrong'}`}>
                      {p.is_correct ? '정답' : '오답'}
                    </span>
                  </>
                )
              }
              return sorted.map((p) => {
                const b = bBySample.get(p.sample_id)
                return (
                  <div className="pred-row" key={p.sample_id}>
                    <img src={variantImageUrl(p.variant_id)} alt={p.class_label} loading="lazy" />
                    <div className="info">
                      <div>정답: <strong>{p.class_label}</strong> <span className="muted">(sample #{p.sample_id})</span></div>
                      <div style={{ marginTop: 4 }}>
                        {isCompare && <span style={{ color: COLORS[0], fontWeight: 700 }}>A </span>}
                        예측: {predBadge(p)}
                      </div>
                      {isCompare && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ color: COLORS[1], fontWeight: 700 }}>B </span>
                          예측: {predBadge(b)}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })
            })()}
            <div style={{ marginTop: 12 }}>
              <button
                className="secondary"
                onClick={() => {
                  setDialogCell(null)
                  navigate(
                    `/predictions?run_id=${effective[0]}&class_label=${encodeURIComponent(dialogCell.cls)}&variant_type=${dialogCell.vt}`,
                  )
                }}
              >
                드릴다운 페이지에서 자세히 보기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

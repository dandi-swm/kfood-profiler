import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart,
  ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, onImgError, sampleImageUrl, variantImageUrl } from '../api/client'
import type { AggRow, VariantType } from '../api/types'
import { VARIANT_TYPES } from '../api/types'
import {
  BAR_CATEGORY_GAP, BAR_GAP, BAR_RADIUS_H, BAR_RADIUS_V, CATEGORICAL, CATEGORICAL_OTHER,
  DIVERGING, INK, SEQUENTIAL_RGB, SERIES, STATUS, axisProps, gridProps, legendProps, tooltipProps,
} from '../theme/chart'

// A/B 계열색 — 슬롯 고정(A=Blue Ivy, B=Clay). 계열 수가 줄어도 색이 재배치되지 않는다.
const COLORS = SERIES
const PIE_COLORS = CATEGORICAL
const PIE_OTHER = CATEGORICAL_OTHER

function pct(v: number | null | undefined): string {
  return v == null ? '–' : `${(v * 100).toFixed(1)}%`
}

function fmtMs(v: number): string {
  if (v < 1000) return `${Math.round(v)}ms`
  const s = v / 1000
  return s >= 10 ? `${Math.round(s)}s` : `${+s.toFixed(1)}s`
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

// 레이턴시는 꼬리가 매우 길어서(중앙값 1~4초, 최대 수백 초) 선형 축으로는
// 대부분이 한 칸에 뭉개진다 → log 축 위에서 히스토그램을 만든다.
function buildLatencyHistogram(sel: number[], base: number[], selKey: string) {
  const all = base.length ? [...sel, ...base] : sel
  const lo = Math.max(1, Math.min(...all))
  const hi = Math.max(...all)
  const BINS = 40
  const llo = Math.log10(lo)
  const step = (Math.log10(hi + 1) - llo) / BINS || 1
  const counts = { sel: new Array<number>(BINS).fill(0), base: new Array<number>(BINS).fill(0) }
  const put = (xs: number[], c: number[]) => {
    for (const v of xs) c[Math.min(BINS - 1, Math.floor((Math.log10(Math.max(v, lo)) - llo) / step))]++
  }
  put(sel, counts.sel)
  put(base, counts.base)
  const data = counts.sel.map((_, i) => ({
    x: Math.round(10 ** (llo + (i + 0.5) * step)),
    [selKey]: counts.sel[i],
    ...(base.length ? { original: counts.base[i] } : {}),
  }))
  const ticks = [100, 300, 1000, 3000, 10000, 30000, 100000, 300000].filter((t) => t >= lo && t <= hi)
  const s = [...sel].sort((a, b) => a - b)
  return {
    data,
    ticks,
    median: quantile(s, 0.5),
    baseMedian: base.length ? quantile([...base].sort((a, b) => a - b), 0.5) : null,
    stats: {
      n: s.length,
      mean: s.reduce((a, b) => a + b, 0) / s.length,
      p90: quantile(s, 0.9),
      p99: quantile(s, 0.99),
      max: s[s.length - 1],
      over10s: s.filter((v) => v > 10000).length,
    },
  }
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
  const [dialogCell, setDialogCell] = useState<{ cls: string; vt: VariantType | null } | null>(null)
  const [distCell, setDistCell] = useState<{ rid: number; vt: VariantType } | null>(null)
  const [lightbox, setLightbox] = useState<{ sampleId: number; label: string } | null>(null)
  const effective = selectedRuns.length ? selectedRuns : doneRuns.slice(0, 1).map((r) => r.id)
  const isCompare = effective.length === 2

  const runName = (id: number) => {
    const r = runs?.find((x) => x.id === id)
    return r
      ? `#${r.id} ${r.name} (${r.model_id}${r.provider === 'gemini' && r.api_path ? `, ${r.api_path}` : ''}${
          r.media_resolution ? `, res=${r.media_resolution}` : ''
        })`
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

  const { data: distLatencies } = useQuery({
    queryKey: ['latencies', distCell?.rid],
    queryFn: () => api.latencies(distCell!.rid),
    enabled: distCell != null,
    staleTime: Infinity,
  })
  const distChart = useMemo(() => {
    const sel = distCell && distLatencies?.[distCell.vt]
    if (!distCell || !sel?.length) return null
    const base = distCell.vt !== 'original' ? (distLatencies?.original ?? []) : []
    return buildLatencyHistogram(sel, base, distCell.vt)
  }, [distCell, distLatencies])

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

  // 변형별 비용: 1,000건당 비용($)과 호출당 평균 입력 토큰 — run별 시리즈
  const costChart = useMemo(() => {
    if (!byVariant) return []
    return VARIANT_TYPES.map((vt) => {
      const row: Record<string, string | number> = { variant: vt }
      effective.forEach((rid) => {
        const found = byVariant.find((r) => r.run_id === rid && r.variant_type === vt)
        if (found?.count) row[runName(rid)] = +((found.cost_usd / found.count) * 1000).toFixed(4)
      })
      return row
    }).filter((r) => Object.keys(r).length > 1)
  }, [byVariant, effective, runs])

  const tokenChart = useMemo(() => {
    if (!byVariant) return []
    return VARIANT_TYPES.map((vt) => {
      const row: Record<string, string | number> = { variant: vt }
      effective.forEach((rid) => {
        const found = byVariant.find((r) => r.run_id === rid && r.variant_type === vt)
        if (found?.avg_input_tokens != null) row[runName(rid)] = Math.round(found.avg_input_tokens)
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

  // run별 오답 카테고리 분포: 상위 7개 + 나머지 롤업 (도넛)
  // 주의: 데이터셋에 "기타"라는 실제 카테고리가 존재하므로 롤업 버킷은 "그 외"로 구분한다.
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
        ...(rest > 0 ? [{ name: '그 외', value: rest, fill: PIE_OTHER }] : []),
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
        variant_type: dialogCell!.vt ?? undefined,
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
        variant_type: dialogCell!.vt ?? undefined,
        page_size: 200,
      }),
    enabled: dialogCell != null && isCompare,
  })

  const single = runTotal(effective[0])

  const diffCell = (a: number | null | undefined, b: number | null | undefined, unit: '%p' | 'ms' | '$') => {
    if (a == null || b == null) return '–'
    const d = unit === '%p' ? (a - b) * 100 : a - b
    const s = d > 0 ? '+' : ''
    const color = Math.abs(d) < 1e-9 ? STATUS.neutral : d > 0 ? COLORS[0] : COLORS[1]
    const text = unit === '%p' ? `${s}${d.toFixed(1)}%p` : unit === 'ms' ? `${s}${Math.round(d)}ms` : `${s}$${d.toFixed(3)}`
    return <span style={{ color, fontWeight: 600 }}>{text}</span>
  }

  return (
    <div>
      <header className="page-head">
        <h1>프로파일링 대시보드</h1>
        <p className="page-sub">
          변형(해상도·압축)별, 클래스별, 모델별 정확도·지연·비용을 봅니다. run을 2개 고르면
          A/B 비교 모드로 바뀝니다.
        </p>
      </header>

      <div className="card">
        <label>비교할 Run (최대 2개 — 2개 선택 시 A/B 비교 모드)</label>
        <div className="run-picker">
          {doneRuns.map((r) => {
            const checked = effective.includes(r.id)
            const idx = effective.indexOf(r.id)
            return (
              <label
                key={r.id}
                className={`run-opt${checked ? ' on' : ''}${
                  !checked && effective.length >= 2 ? ' off' : ''
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && effective.length >= 2}
                  onChange={(e) => toggleRun(r.id, e.target.checked)}
                />{' '}
                {checked && isCompare && (
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[idx] }} />
                    {idx === 0 ? 'A' : 'B'}
                  </span>
                )}
                #{r.id} {r.name}{' '}
                <span className="muted">
                  ({r.model_id}{r.media_resolution ? `, res=${r.media_resolution}` : ''})
                </span>
              </label>
            )
          })}
          {!doneRuns.length && <span className="muted">완료된 run이 아직 없습니다.</span>}
        </div>
      </div>

      {isCompare ? (
        <div className="card">
          <h3>A/B 비교 요약</h3>
          <div style={{ overflowX: 'auto' }}>
          <table className="kv-table">
            <thead>
              <tr>
                <th>지표</th>
                <th>
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[0] }} /> A
                  </span>{' '}
                  {runName(effective[0])}
                </th>
                <th>
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[1] }} /> B
                  </span>{' '}
                  {runName(effective[1])}
                </th>
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
        <h3>변형(해상도/압축)별 정확도 — 같은 사진 기준</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={variantChart} barGap={BAR_GAP} barCategoryGap={BAR_CATEGORY_GAP}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="variant" {...axisProps} />
            <YAxis unit="%" domain={[0, 100]} {...axisProps} />
            <Tooltip {...tooltipProps} />
            {effective.length > 1 && <Legend {...legendProps} />}
            {effective.map((rid, i) => (
              <Bar
                key={rid}
                dataKey={runName(rid)}
                fill={COLORS[i % COLORS.length]}
                radius={BAR_RADIUS_V}
                maxBarSize={56}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>원본 대비 상대 성능</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          같은 사진들의 original 결과를 100% 기준으로, 각 변형이 상대적으로 얼마나 나빠지는지 / 빨라지는지.
        </p>
        {effective.map((rid) => {
          const rows = byVariant?.filter((r) => r.run_id === rid) ?? []
          const base = rows.find((r) => r.variant_type === 'original')
          if (!rows.length) return null
          return (
            <div key={rid} style={{ marginBottom: 18 }}>
              <strong style={{ fontSize: 13 }}>
                {isCompare && (
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[effective.indexOf(rid)] }} />
                    {effective.indexOf(rid) === 0 ? 'A' : 'B'}
                  </span>
                )}{' '}
                {runName(rid)}
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
                    const dpColor =
                      dp == null || isBase
                        ? STATUS.neutral
                        : dp < -1
                          ? STATUS.danger
                          : dp > 1
                            ? STATUS.ok
                            : STATUS.neutral
                    const isOpen = distCell?.rid === rid && distCell.vt === vt
                    return (
                      <tr
                        key={vt}
                        onClick={() => setDistCell(isOpen ? null : { rid, vt })}
                        style={{ cursor: 'pointer', background: isOpen ? 'var(--bg-selected)' : undefined }}
                        title="클릭하면 처리시간 분포를 봅니다"
                      >
                        <td>{vt}{isBase && <span className="muted"> (기준)</span>}</td>
                        <td>{pct(acc)}</td>
                        <td>{isBase ? '100%' : rel != null ? `${rel.toFixed(1)}%` : '–'}</td>
                        <td style={{ color: dpColor, fontWeight: isBase ? 400 : 600 }}>
                          {isBase ? '–' : dp != null ? `${dp > 0 ? '+' : ''}${dp.toFixed(1)}%p` : '–'}
                        </td>
                        <td>{r.avg_latency_ms != null ? `${Math.round(r.avg_latency_ms)}ms` : '–'}</td>
                        <td>
                          {isBase ? '×1.00' : latRatio != null ? `×${latRatio.toFixed(2)}` : '–'}
                          {!isBase && latRatio != null && latRatio < 0.95 && <span style={{ color: STATUS.ok }}> (빠름)</span>}
                          {!isBase && latRatio != null && latRatio > 1.05 && <span style={{ color: STATUS.danger }}> (느림)</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {distCell?.rid === rid && (
                <div className="inset">
                  <strong style={{ fontSize: 13 }}>
                    {distCell.vt} 처리시간 분포
                    {distCell.vt !== 'original' && <span className="muted"> — original과 겹쳐 보기</span>}
                  </strong>
                  {!distChart ? (
                    <p className="muted">불러오는 중…</p>
                  ) : (
                    <>
                      <ResponsiveContainer width="100%" height={240}>
                        <AreaChart data={distChart.data} margin={{ top: 8, right: 16 }}>
                          <CartesianGrid {...gridProps} />
                          <XAxis
                            dataKey="x"
                            type="number"
                            scale="log"
                            domain={['dataMin', 'dataMax']}
                            ticks={distChart.ticks}
                            tickFormatter={fmtMs}
                            {...axisProps}
                          />
                          <YAxis
                            allowDecimals={false}
                            {...axisProps}
                            label={{ value: '건수', angle: -90, position: 'insideLeft', fontSize: 11, fill: INK.tick }}
                          />
                          <Tooltip
                            {...tooltipProps}
                            cursor={{ stroke: INK.axis, strokeDasharray: '3 3' }}
                            labelFormatter={(v) => `~${fmtMs(Number(v))} 부근`}
                            formatter={(v: number, name: string) => [`${v}건`, name]}
                          />
                          <Legend {...legendProps} />
                          {distCell.vt !== 'original' && (
                            <Area type="monotone" dataKey="original" stroke={INK.faint} fill={INK.faint} fillOpacity={0.18} strokeWidth={2} />
                          )}
                          <Area type="monotone" dataKey={distCell.vt} stroke={COLORS[0]} fill={COLORS[0]} fillOpacity={0.24} strokeWidth={2} />
                          <ReferenceLine
                            x={distChart.median}
                            stroke={COLORS[0]}
                            strokeDasharray="4 3"
                            label={{ value: `중앙값 ${fmtMs(distChart.median)}`, fontSize: 11, fill: COLORS[0], position: 'top' }}
                          />
                          {distChart.baseMedian != null && (
                            <ReferenceLine x={distChart.baseMedian} stroke={INK.faint} strokeDasharray="4 3" />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                      <p className="muted" style={{ marginBottom: 0 }}>
                        n={distChart.stats.n.toLocaleString()} · 중앙값 {fmtMs(distChart.median)} · 평균{' '}
                        {fmtMs(distChart.stats.mean)} · p90 {fmtMs(distChart.stats.p90)} · p99{' '}
                        {fmtMs(distChart.stats.p99)} · 최대 {fmtMs(distChart.stats.max)} · 10초 초과{' '}
                        {distChart.stats.over10s}건 — 가로축은 log 스케일입니다. 평균은 오른쪽 꼬리(이상치)에
                        끌려가고, 몸통의 위치는 중앙값이 보여줍니다.
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <p className="muted">행을 클릭하면 그 변형의 처리시간 분포를 original과 겹쳐 볼 수 있습니다.</p>
      </div>

      <div className="card">
        <h3>변형별 평균 처리시간 (ms)</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={latencyChart} barGap={BAR_GAP} barCategoryGap={BAR_CATEGORY_GAP}>
            <CartesianGrid {...gridProps} />
            <XAxis dataKey="variant" {...axisProps} />
            <YAxis unit="ms" {...axisProps} />
            <Tooltip {...tooltipProps} />
            {effective.length > 1 && <Legend {...legendProps} />}
            {effective.map((rid, i) => (
              <Bar
                key={rid}
                dataKey={runName(rid)}
                fill={COLORS[i % COLORS.length]}
                radius={BAR_RADIUS_V}
                maxBarSize={56}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="card">
        <h3>변형별 처리 비용 · 토큰</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          같은 사진을 변형만 바꿔 보냈을 때의 호출당 비용과 입력/출력 토큰. 입력 토큰에는 프롬프트(클래스 목록)가
          포함되어 있어, 변형 간 차이가 곧 이미지 토큰 차이입니다.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 16 }}>
          {[
            { title: '1,000건당 비용 ($)', data: costChart, fmt: (v: number) => `$${v.toFixed(3)}` },
            { title: '호출당 평균 입력 토큰', data: tokenChart, fmt: (v: number) => v.toLocaleString() },
          ].map((c) => (
            <div key={c.title}>
              <strong style={{ fontSize: 13 }}>{c.title}</strong>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={c.data} barGap={BAR_GAP} barCategoryGap={BAR_CATEGORY_GAP}>
                  <CartesianGrid {...gridProps} />
                  <XAxis dataKey="variant" {...axisProps} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => c.fmt(v)} width={64} />
                  <Tooltip {...tooltipProps} formatter={(v: number, name: string) => [c.fmt(v), name]} />
                  {effective.length > 1 && <Legend {...legendProps} />}
                  {effective.map((rid, i) => (
                    <Bar
                      key={rid}
                      dataKey={runName(rid)}
                      fill={COLORS[i % COLORS.length]}
                      radius={BAR_RADIUS_V}
                      maxBarSize={48}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
        {effective.map((rid) => {
          const rows = byVariant?.filter((r) => r.run_id === rid) ?? []
          const base = rows.find((r) => r.variant_type === 'original')
          if (!rows.length) return null
          const perCall = (r: AggRow) => (r.count ? r.cost_usd / r.count : null)
          const baseCost = base ? perCall(base) : null
          const baseIn = base?.avg_input_tokens ?? null
          return (
            <div key={rid} style={{ marginTop: 18 }}>
              <strong style={{ fontSize: 13 }}>
                {isCompare && (
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[effective.indexOf(rid)] }} />
                    {effective.indexOf(rid) === 0 ? 'A' : 'B'}
                  </span>
                )}{' '}
                {runName(rid)}
              </strong>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ marginTop: 6 }}>
                  <thead>
                    <tr>
                      <th>변형</th><th>평균 파일 크기</th><th>입력 토큰/호출</th><th>원본 대비</th>
                      <th>출력 토큰/호출</th><th>호출당 비용</th><th>1,000건당</th><th>비용 배율</th>
                      <th>총 입력 토큰</th><th>총 비용</th>
                    </tr>
                  </thead>
                  <tbody>
                    {VARIANT_TYPES.map((vt) => {
                      const r = rows.find((x) => x.variant_type === vt)
                      if (!r) return null
                      const isBase = vt === 'original'
                      const c = perCall(r)
                      const ratio = baseCost && c != null ? c / baseCost : null
                      const dIn =
                        baseIn != null && r.avg_input_tokens != null ? r.avg_input_tokens - baseIn : null
                      const ratioColor =
                        ratio == null || isBase
                          ? STATUS.neutral
                          : ratio < 0.97 ? STATUS.ok : ratio > 1.03 ? STATUS.danger : STATUS.neutral
                      return (
                        <tr key={vt}>
                          <td>{vt}{isBase && <span className="muted"> (기준)</span>}</td>
                          <td>{r.avg_bytes != null ? `${(r.avg_bytes / 1024).toFixed(1)}KB` : '–'}</td>
                          <td>{r.avg_input_tokens != null ? Math.round(r.avg_input_tokens).toLocaleString() : '–'}</td>
                          <td>{isBase ? '–' : dIn != null ? `${dIn > 0 ? '+' : ''}${Math.round(dIn).toLocaleString()}` : '–'}</td>
                          <td>{r.avg_output_tokens != null ? r.avg_output_tokens.toFixed(1) : '–'}</td>
                          <td>{c != null ? `$${c.toFixed(6)}` : '–'}</td>
                          <td>{c != null ? `$${(c * 1000).toFixed(3)}` : '–'}</td>
                          <td style={{ color: ratioColor, fontWeight: isBase ? 400 : 600 }}>
                            {isBase ? '×1.00' : ratio != null ? `×${ratio.toFixed(2)}` : '–'}
                          </td>
                          <td>{r.input_tokens.toLocaleString()}</td>
                          <td>${r.cost_usd.toFixed(4)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h3>
          클래스별 정확도 {isCompare ? '(A/B 차이 큰 순)' : '(낮은 순)'}
        </h3>
        <div style={{ overflowX: 'auto' }}>
          <ResponsiveContainer width="100%" height={Math.max(260, classChart.length * (isCompare ? 30 : 16))}>
            <BarChart
              data={classChart}
              layout="vertical"
              margin={{ left: 60 }}
              barGap={BAR_GAP}
              barCategoryGap="32%"
              style={{ cursor: 'pointer' }}
              onClick={(state) => {
                const label = (state as { activeLabel?: string } | null)?.activeLabel
                if (label) setDialogCell({ cls: label, vt: null })
              }}
            >
              <CartesianGrid {...gridProps} vertical horizontal={false} />
              <XAxis type="number" unit="%" domain={[0, 100]} {...axisProps} />
              <YAxis
                type="category"
                dataKey="label"
                width={90}
                interval={0}
                {...axisProps}
              />
              <Tooltip {...tooltipProps} />
              {isCompare && <Legend {...legendProps} />}
              {effective.map((rid, i) => (
                <Bar
                  key={rid}
                  dataKey={runName(rid)}
                  fill={COLORS[i % COLORS.length]}
                  radius={BAR_RADIUS_H}
                  maxBarSize={12}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted">막대를 클릭하면 그 음식의 변형별 예측 결과를 볼 수 있습니다.</p>
      </div>

      <div className="card">
        <h3>오답의 카테고리 분포</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          틀린 예측들이 어떤 음식 카테고리에서 나왔는지 (오답 많은 상위 7개 + 나머지는 "그 외"로 묶음).
        </p>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {wrongPies.map(({ rid, data, total }) => (
            <div key={rid} style={{ flex: '1 1 420px', minWidth: 380 }}>
              <strong style={{ fontSize: 13 }}>
                {isCompare && (
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[effective.indexOf(rid)] }} />
                    {effective.indexOf(rid) === 0 ? 'A' : 'B'}
                  </span>
                )}{' '}
                {runName(rid)}
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
                        innerRadius="52%"
                        outerRadius="82%"
                        stroke={INK.surface}
                        strokeWidth={2}
                      >
                        {data.map((d) => <Cell key={d.name} fill={d.fill} />)}
                      </Pie>
                      <Tooltip
                        {...tooltipProps}
                        cursor={false}
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
                            <span
                              className="swatch"
                              style={{ background: d.fill, marginRight: 6, verticalAlign: 0 }}
                            />
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
        <h3>
          클래스 × 변형 매트릭스 {isCompare && <span className="muted">— 셀: A / B</span>} (셀 클릭 → 오답 드릴다운)
        </h3>
        {isCompare && (
          <p className="muted" style={{ marginTop: 0 }}>
            <span className="chip-legend">
              <span className="swatch" style={{ background: COLORS[0] }} /> A
            </span>{' '}
            = {runName(effective[0])}
            {' · '}
            <span className="chip-legend">
              <span className="swatch" style={{ background: COLORS[1] }} /> B
            </span>{' '}
            = {runName(effective[1])}
          </p>
        )}
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
        <div className="scroll-y" style={{ maxHeight: 420 }}>
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
                      // 발산 스케일: 양극은 A/B 계열색, 중앙(차이 없음)은 표면색 그대로
                      bg = d > 0.001
                        ? `rgba(${DIVERGING.posRgb}, ${Math.min(0.55, Math.abs(d))})`
                        : d < -0.001
                          ? `rgba(${DIVERGING.negRgb}, ${Math.min(0.55, Math.abs(d))})`
                          : undefined
                    } else if (accA != null) {
                      // 순차 스케일: 한 색상, 정확도가 낮을수록 진하게
                      bg = `rgba(${SEQUENTIAL_RGB}, ${0.06 + 0.46 * (1 - accA)})`
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
          {isCompare ? (
            <>
              <span className="chip-legend">
                <span className="swatch" style={{ background: COLORS[0] }} /> A 우세
              </span>
              {' · '}
              <span className="chip-legend">
                <span className="swatch" style={{ background: COLORS[1] }} /> B 우세
              </span>
              {' — 진할수록 차이가 큽니다. 색이 없는 셀은 차이 없음.'}
            </>
          ) : (
            '배경이 진할수록 정확도가 낮은 셀입니다.'
          )}
        </p>
      </div>

      {dialogCell && (
        <div className="modal-overlay" onClick={() => setDialogCell(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>
                {dialogCell.cls} × {dialogCell.vt ?? '전체 변형'}
              </h3>
              <button className="modal-close" onClick={() => setDialogCell(null)}>닫기 ✕</button>
            </div>
            <p className="muted" style={{ marginTop: 0 }}>
              {isCompare ? (
                <>
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[0] }} /> A
                  </span>{' '}
                  = {runName(effective[0])}
                  {' · '}
                  <span className="chip-legend">
                    <span className="swatch" style={{ background: COLORS[1] }} /> B
                  </span>{' '}
                  = {runName(effective[1])}
                </>
              ) : (
                <>{runName(effective[0])}</>
              )}
            </p>
            {(() => {
              const itemsA = dialogPredsA?.items ?? []
              const itemsB = dialogPredsB?.items ?? []
              if (!itemsA.length) return <p className="muted">불러오는 중…</p>

              const predBadgeAll = (p?: { predicted_label: string | null; is_correct: boolean | null; status: string }) => {
                if (!p) return <span className="muted">–</span>
                if (p.status === 'error') return <span className="badge error">에러</span>
                return (
                  <>
                    {p.predicted_label ?? '–'}{' '}
                    <span className={`badge ${p.is_correct ? 'correct' : 'wrong'}`}>
                      {p.is_correct ? '○' : '✕'}
                    </span>
                  </>
                )
              }

              if (dialogCell.vt == null) {
                // 클래스 전체: 샘플별 행 × 변형별 열
                const sampleIds = [...new Set(itemsA.map((p) => p.sample_id))]
                const find = (items: typeof itemsA, sid: number, vt: string) =>
                  items.find((p) => p.sample_id === sid && p.variant_type === vt)
                // 오답이 있는 샘플을 위로
                sampleIds.sort((x, y) => {
                  const wrong = (sid: number) =>
                    [...itemsA, ...itemsB].some((p) => p.sample_id === sid && p.is_correct === false) ? 0 : 1
                  return wrong(x) - wrong(y)
                })
                return sampleIds.map((sid) => {
                  const anchor = find(itemsA, sid, 'original') ?? itemsA.find((p) => p.sample_id === sid)!
                  return (
                    <div className="pred-row" key={sid} style={{ alignItems: 'flex-start' }}>
                      <img
                        src={variantImageUrl(anchor.variant_id)}
                        alt={anchor.class_label}
                        loading="lazy"
                        data-fallback={sampleImageUrl(sid)}
                        onError={onImgError}
                        onClick={() => setLightbox({ sampleId: sid, label: anchor.class_label })}
                      />
                      <div className="info" style={{ flex: 1 }}>
                        <div>정답: <strong>{anchor.class_label}</strong> <span className="muted">(sample #{sid})</span></div>
                        <table style={{ marginTop: 6 }}>
                          <thead>
                            <tr>
                              {isCompare && <th></th>}
                              {VARIANT_TYPES.map((vt) => <th key={vt}>{vt}</th>)}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              {isCompare && (
                                <td>
                                  <span className="chip-legend">
                                    <span className="swatch" style={{ background: COLORS[0] }} /> A
                                  </span>
                                </td>
                              )}
                              {VARIANT_TYPES.map((vt) => (
                                <td key={vt}>{predBadgeAll(find(itemsA, sid, vt))}</td>
                              ))}
                            </tr>
                            {isCompare && (
                              <tr>
                                <td>
                                  <span className="chip-legend">
                                    <span className="swatch" style={{ background: COLORS[1] }} /> B
                                  </span>
                                </td>
                                {VARIANT_TYPES.map((vt) => (
                                  <td key={vt}>{predBadgeAll(find(itemsB, sid, vt))}</td>
                                ))}
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })
              }

              const bBySample = new Map(itemsB.map((p) => [p.sample_id, p]))
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
                    <img
                      src={variantImageUrl(p.variant_id)}
                      alt={p.class_label}
                      loading="lazy"
                      data-fallback={sampleImageUrl(p.sample_id)}
                      onError={onImgError}
                      onClick={() => setLightbox({ sampleId: p.sample_id, label: p.class_label })}
                    />
                    <div className="info">
                      <div>정답: <strong>{p.class_label}</strong> <span className="muted">(sample #{p.sample_id})</span></div>
                      <div style={{ marginTop: 4 }}>
                        {isCompare && (
                          <span className="chip-legend">
                            <span className="swatch" style={{ background: COLORS[0] }} /> A{' '}
                          </span>
                        )}
                        예측: {predBadge(p)}
                      </div>
                      {isCompare && (
                        <div style={{ marginTop: 4 }}>
                          <span className="chip-legend">
                            <span className="swatch" style={{ background: COLORS[1] }} /> B{' '}
                          </span>
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
                    `/predictions?run_id=${effective[0]}&class_label=${encodeURIComponent(dialogCell.cls)}${dialogCell.vt ? `&variant_type=${dialogCell.vt}` : ''}`,
                  )
                }}
              >
                드릴다운 페이지에서 자세히 보기
              </button>
            </div>
          </div>
        </div>
      )}

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <img src={sampleImageUrl(lightbox.sampleId)} alt={lightbox.label} onError={onImgError} />
          <div className="lightbox-caption">
            {lightbox.label} (sample #{lightbox.sampleId}) — 원본 이미지 · 클릭하면 닫힘
          </div>
        </div>
      )}
    </div>
  )
}

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

export default function ManifestsPage() {
  const qc = useQueryClient()
  const { data: classes } = useQuery({ queryKey: ['classes'], queryFn: api.classes })
  const { data: manifests } = useQuery({
    queryKey: ['manifests'],
    queryFn: api.manifests,
    refetchInterval: (q) =>
      q.state.data?.some((m) => m.status === 'creating') ? 2000 : false,
  })

  const [name, setName] = useState('')
  const [seed, setSeed] = useState(42)
  const [perClass, setPerClass] = useState(20)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [filterOn, setFilterOn] = useState(false)

  const create = useMutation({
    mutationFn: api.createManifest,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['manifests'] })
      setName('')
    },
  })
  const remove = useMutation({
    mutationFn: api.deleteManifest,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manifests'] }),
  })

  const totalClasses = classes?.length ?? 0
  const effectiveClasses = filterOn ? selected.size : totalClasses
  const estSamples = effectiveClasses * perClass

  const byCategory = useMemo(() => {
    const m = new Map<string, typeof classes>()
    classes?.forEach((c) => {
      const list = m.get(c.category) ?? []
      list.push(c)
      m.set(c.category, list)
    })
    return m
  }, [classes])

  return (
    <div>
      <h2>샘플셋 (Manifest)</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>새 Manifest 만들기</h3>
        <div className="form-row">
          <div>
            <label>이름</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: baseline-20" />
          </div>
          <div>
            <label>시드</label>
            <input type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} />
          </div>
          <div>
            <label>클래스당 이미지 수</label>
            <input type="number" value={perClass} min={1} max={200} onChange={(e) => setPerClass(+e.target.value)} />
          </div>
          <div>
            <label>
              <input type="checkbox" checked={filterOn} onChange={(e) => setFilterOn(e.target.checked)} />{' '}
              일부 클래스만 사용
            </label>
            {filterOn && <span className="muted">{selected.size}개 선택됨</span>}
          </div>
          <button
            disabled={!name || create.isPending || (filterOn && selected.size === 0)}
            onClick={() =>
              create.mutate({
                name,
                seed,
                per_class: perClass,
                class_filter: filterOn ? [...selected] : null,
              })
            }
          >
            생성 ({estSamples.toLocaleString()}샘플 × 5변형 = {(estSamples * 5).toLocaleString()}파일)
          </button>
        </div>
        {create.isError && <div className="error-text">{(create.error as Error).message}</div>}
        <p className="muted">
          같은 시드는 항상 같은 샘플 집합을 뽑습니다 (모델 간 공정 비교). 최장변 512px 미만 이미지는
          해상도 변형이 무의미해 자동 제외됩니다.
        </p>
        {filterOn && (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {[...byCategory.entries()].map(([cat, list]) => (
              <div key={cat} style={{ marginBottom: 6 }}>
                <strong style={{ fontSize: 13 }}>{cat}</strong>{' '}
                {list!.map((c) => (
                  <label key={c.label} style={{ display: 'inline-block', margin: '2px 8px', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={selected.has(c.label)}
                      onChange={(e) => {
                        const next = new Set(selected)
                        e.target.checked ? next.add(c.label) : next.delete(c.label)
                        setSelected(next)
                      }}
                    />{' '}
                    {c.label} <span className="muted">({c.image_count})</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Manifest 목록</h3>
        <table>
          <thead>
            <tr>
              <th>ID</th><th>이름</th><th>시드</th><th>클래스당</th><th>클래스 수</th>
              <th>샘플 수</th><th>상태</th><th>생성일</th><th></th>
            </tr>
          </thead>
          <tbody>
            {manifests?.map((m) => (
              <tr key={m.id}>
                <td>{m.id}</td>
                <td>{m.name}</td>
                <td>{m.seed}</td>
                <td>{m.per_class}</td>
                <td>{m.class_count}</td>
                <td>{m.sample_count.toLocaleString()}</td>
                <td>
                  <span className={`badge ${m.status}`}>{m.status}</span>
                  {m.error && <div className="error-text">{m.error}</div>}
                </td>
                <td className="muted">{new Date(m.created_at + 'Z').toLocaleString('ko')}</td>
                <td>
                  <button className="secondary" onClick={() => remove.mutate(m.id)}>삭제</button>
                </td>
              </tr>
            ))}
            {!manifests?.length && (
              <tr><td colSpan={9} className="muted">아직 없습니다. 위에서 생성하세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>데이터셋 클래스 ({totalClasses}개)</h3>
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table>
            <thead><tr><th>음식명</th><th>카테고리</th><th>이미지 수</th></tr></thead>
            <tbody>
              {classes?.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td><td>{c.category}</td><td>{c.image_count.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

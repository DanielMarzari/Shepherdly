'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface TreeNode {
  id: string
  name: string
  role: 'shepherd' | 'member'
  supervisorId: string | null
  flockCount: number
  lastCheckin: string | null
  isCurrentUser: boolean
  contextLabel: string | null
  warning: string | null
}

interface LayoutNode extends TreeNode {
  x: number
  y: number
  children: LayoutNode[]
  depth: number
}

const NODE_W = 180
const NODE_H = 72
const H_GAP = 40
const V_GAP = 100

function buildTree(nodes: TreeNode[]): LayoutNode[] {
  const map = new Map<string, LayoutNode>()
  for (const n of nodes) {
    map.set(n.id, { ...n, x: 0, y: 0, children: [], depth: 0 })
  }

  const roots: LayoutNode[] = []
  for (const n of map.values()) {
    if (n.supervisorId && map.has(n.supervisorId)) {
      map.get(n.supervisorId)!.children.push(n)
    } else {
      roots.push(n)
    }
  }

  // Recursive layout
  function measureWidth(node: LayoutNode): number {
    if (!node.children.length) return NODE_W
    const childWidths = node.children.map(measureWidth)
    const total = childWidths.reduce((a, b) => a + b, 0) + H_GAP * (node.children.length - 1)
    return Math.max(NODE_W, total)
  }

  function layout(node: LayoutNode, x: number, y: number, depth: number) {
    node.x = x
    node.y = y
    node.depth = depth
    if (!node.children.length) return
    const totalW = node.children.map(measureWidth).reduce((a, b) => a + b, 0) + H_GAP * (node.children.length - 1)
    let cx = x - totalW / 2
    for (const child of node.children) {
      const cw = measureWidth(child)
      layout(child, cx + cw / 2, y + NODE_H + V_GAP, depth + 1)
      cx += cw + H_GAP
    }
  }

  // Layout roots side by side
  let rx = 0
  for (const root of roots) {
    const w = measureWidth(root)
    layout(root, rx + w / 2, 0, 0)
    rx += w + H_GAP * 2
  }

  return [...map.values()]
}

function flattenTree(nodes: LayoutNode[]): LayoutNode[] {
  return nodes
}

function getAllEdges(nodes: LayoutNode[]): { from: LayoutNode; to: LayoutNode }[] {
  const map = new Map(nodes.map(n => [n.id, n]))
  const edges: { from: LayoutNode; to: LayoutNode }[] = []
  for (const n of nodes) {
    if (n.supervisorId && map.has(n.supervisorId)) {
      edges.push({ from: map.get(n.supervisorId)!, to: n })
    }
  }
  return edges
}

function healthColor(node: TreeNode): string {
  if (node.flockCount === 0) return '#94a3b8'
  if (!node.lastCheckin) return '#9b3a3a' // no check-in ever
  const daysSince = Math.floor((Date.now() - new Date(node.lastCheckin).getTime()) / (1000 * 60 * 60 * 24))
  if (daysSince <= 7) return '#4a7c59'   // green — recent
  if (daysSince <= 30) return '#c17f3e'  // orange — needs attention
  return '#9b3a3a'                        // red — at risk
}

function checkinLabel(node: TreeNode): string {
  if (!node.lastCheckin) return 'No check-ins'
  const daysSince = Math.floor((Date.now() - new Date(node.lastCheckin).getTime()) / (1000 * 60 * 60 * 24))
  if (daysSince === 0) return 'Today'
  if (daysSince === 1) return '1 day ago'
  return `${daysSince}d ago`
}

interface GroupTypeOption {
  id: string
  name: string
  is_tracked: boolean
}

interface ServiceTypeOption {
  id: string
  name: string
}

export default function ShepherdTree() {
  const svgRef = useRef<SVGSVGElement>(null)
  const [nodes, setNodes] = useState<LayoutNode[]>([])
  const [edges, setEdges] = useState<{ from: LayoutNode; to: LayoutNode }[]>([])
  const [selected, setSelected] = useState<LayoutNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d')
  const [connecting, setConnecting] = useState<{ shepherdId: string; shepherdName: string } | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [allNodes, setAllNodes] = useState<TreeNode[]>([])
  const [addingPerson, setAddingPerson] = useState(false)
  const [addSearch, setAddSearch] = useState('')
  const [addResults, setAddResults] = useState<{ id: string; name: string; pco_id: string | null }[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [groupTypes, setGroupTypes] = useState<GroupTypeOption[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([])
  const [assignTab, setAssignTab] = useState<'person' | 'group_type' | 'service_type'>('person')
  const [bulkAssigning, setBulkAssigning] = useState(false)

  // Pan & zoom state
  const [transform, setTransform] = useState({ x: 0, y: 60, scale: 1 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const fetchTree = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/tree')
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }

    setAllNodes(data.nodes || [])
    setCurrentUserRole(data.currentUserRole || null)
    setGroupTypes(data.groupTypes || [])
    setServiceTypes(data.serviceTypes || [])
    const laid = buildTree(data.nodes)
    setNodes(laid)
    setEdges(getAllEdges(laid))

    // Center on root
    if (laid.length > 0) {
      const minX = Math.min(...laid.map(n => n.x)) - NODE_W / 2
      const maxX = Math.max(...laid.map(n => n.x)) + NODE_W / 2
      const treeW = maxX - minX
      setTransform({ x: -minX - treeW / 2, y: 60, scale: 1 })
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTree() }, [fetchTree])

  // People search for add-person
  useEffect(() => {
    if (addSearch.length < 2) { setAddResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/people?search=${encodeURIComponent(addSearch)}&all=true`)
      const data = await res.json()
      setAddResults((data.people || []).slice(0, 8).map((p: any) => ({
        id: p.id, name: p.name, pco_id: p.pco_id,
      })))
    }, 300)
    return () => clearTimeout(t)
  }, [addSearch])

  const addPersonToTree = async (personId: string, shepherdId?: string) => {
    if (shepherdId) {
      await fetch(`/api/people/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_shepherd', shepherd_id: shepherdId, context_type: 'manual' }),
      })
    }
    // Mark as leader so they show in tree
    await fetch(`/api/people/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_leader: true }),
    })
    setAddingPerson(false)
    setAddSearch('')
    setAddResults([])
    fetchTree()
  }

  const assignShepherd = async (personId: string, shepherdId: string) => {
    await fetch(`/api/people/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_shepherd', shepherd_id: shepherdId, context_type: 'manual' }),
    })
    setConnecting(null)
    setSearchTerm('')
    fetchTree()
  }

  const unassignShepherd = async (personId: string) => {
    // Remove manual relationship - find it first
    const res = await fetch(`/api/people/${personId}`)
    const data = await res.json()
    const manualRel = data.person?.shepherds?.find((s: any) => s.context_type === 'manual' && s.is_active)
    if (manualRel) {
      await fetch(`/api/people/${personId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_shepherd', relationship_id: manualRel.id }),
      })
      fetchTree()
    }
  }

  // Bounds
  const minX = nodes.length ? Math.min(...nodes.map(n => n.x)) - NODE_W / 2 - 40 : -400
  const maxX = nodes.length ? Math.max(...nodes.map(n => n.x)) + NODE_W / 2 + 40 : 400
  const minY = -40
  const maxY = nodes.length ? Math.max(...nodes.map(n => n.y)) + NODE_H + 60 : 400
  const vbW = maxX - minX
  const vbH = maxY - minY

  // Interactions
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.tree-node')) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform(t => ({ ...t, x: t.x + dx / t.scale, y: t.y + dy / t.scale }))
  }
  const onMouseUp = () => { dragging.current = false }

  // Attach wheel handler natively with { passive: false } to allow preventDefault
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setTransform(t => ({ ...t, scale: Math.min(3, Math.max(0.05, t.scale * delta)) }))
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [])

  if (loading) return (
    <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--muted-foreground)' }}>
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
        <p className="sans text-sm">Loading shepherd tree…</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="sans text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
    </div>
  )

  if (nodes.length === 0) return (
    <div className="flex-1 flex items-center justify-center text-center px-8">
      <div>
        <p className="font-serif text-2xl mb-2" style={{ color: 'var(--primary)' }}>No leaders found</p>
        <p className="sans text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Sync your groups and teams from PCO to populate the shepherd tree.
        </p>
      </div>
    </div>
  )

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 border-b shrink-0"
        style={{ borderColor: 'var(--border)', background: 'white' }}>
        <div>
          <h1 className="font-serif text-xl" style={{ color: 'var(--primary)' }}>Shepherd Tree</h1>
          <p className="sans text-xs mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {nodes.filter(n => n.role === 'shepherd').length} shepherds · {nodes.filter(n => n.role === 'member').length} members · scroll to zoom · drag to pan
          </p>
        </div>
        <div className="flex items-center gap-3">
          {/* Health legend */}
          <div className="hidden md:flex items-center gap-3 text-xs sans mr-2"
            style={{ color: 'var(--muted-foreground)' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#4a7c59' }} />
              Healthy
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#c17f3e' }} />
              Needs attention
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: '#9b3a3a' }} />
              At risk
            </span>
          </div>
          {/* View toggle */}
          <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            {(['2d', '3d'] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className="px-3 py-1.5 text-xs font-medium sans transition-colors"
                style={{
                  background: viewMode === v ? 'var(--primary)' : 'white',
                  color: viewMode === v ? 'white' : 'var(--muted-foreground)',
                }}>
                {v.toUpperCase()}
              </button>
            ))}
          </div>
          {/* Add Person (admin/staff) */}
          {['super_admin', 'staff'].includes(currentUserRole || '') && (
            <button onClick={() => setAddingPerson(true)}
              className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
              style={{ background: 'var(--primary)', color: 'white' }}>
              + Add Person
            </button>
          )}
          {/* Reset */}
          <button onClick={() => setTransform({ x: 0, y: 60, scale: 1 })}
            className="text-xs sans px-3 py-1.5 rounded-lg border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
            Reset View
          </button>
        </div>
      </div>

      {/* Tree canvas */}
      <div className="flex-1 relative overflow-hidden" style={{ background: 'var(--muted)' }}>
        <svg
          ref={svgRef}
          className="w-full h-full cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.5"/>
            </pattern>
            <filter id="shadow">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08"/>
            </filter>
          </defs>

          {/* Grid background */}
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${(svgRef.current?.clientWidth ?? 800) / 2 + transform.x * transform.scale}, ${transform.y}) scale(${transform.scale})`}>
            {/* Edges */}
            <g>
              {edges.map(({ from, to }) => {
                const fx = from.x
                const fy = from.y + NODE_H
                const tx = to.x
                const ty = to.y
                const my = (fy + ty) / 2
                return (
                  <path
                    key={`${from.id}-${to.id}`}
                    d={`M ${fx} ${fy} C ${fx} ${my}, ${tx} ${my}, ${tx} ${ty}`}
                    fill="none"
                    stroke="var(--border)"
                    strokeWidth="1.5"
                    strokeDasharray={viewMode === '3d' ? 'none' : 'none'}
                  />
                )
              })}
            </g>

            {/* Nodes */}
            {nodes.map(node => {
              const isShepherd = node.role === 'shepherd'
              const color = isShepherd ? '#4a7c59' : '#6b7280'
              const health = healthColor(node)
              const isSelected = selected?.id === node.id
              const initials = node.name
                .split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()

              return (
                <g
                  key={node.id}
                  className="tree-node"
                  transform={`translate(${node.x - NODE_W / 2}, ${node.y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(isSelected ? null : node)}
                >
                  {/* Shadow layer for 3d effect */}
                  {viewMode === '3d' && (
                    <rect
                      x={4} y={4}
                      width={NODE_W} height={NODE_H}
                      rx={10}
                      fill={color}
                      opacity={0.15}
                    />
                  )}

                  {/* Card */}
                  <rect
                    x={0} y={0}
                    width={NODE_W} height={NODE_H}
                    rx={10}
                    fill={node.isCurrentUser ? color : 'white'}
                    stroke={isSelected ? color : node.isCurrentUser ? color : 'var(--border)'}
                    strokeWidth={isSelected ? 2.5 : 1}
                    filter="url(#shadow)"
                  />

                  {/* Left color bar */}
                  <rect x={0} y={0} width={4} height={NODE_H} rx={2}
                    fill={color} style={{ clipPath: 'inset(0 0 0 0 round 10px 0 0 10px)' }} />

                  {/* Health dot — only for shepherds */}
                  {isShepherd && !node.warning && <circle cx={NODE_W - 10} cy={10} r={4} fill={health} />}

                  {/* Warning indicator */}
                  {node.warning && (
                    <g transform={`translate(${NODE_W - 16}, 4)`}>
                      <polygon points="6,0 12,11 0,11" fill="#c17f3e" />
                      <text x={6} y={9} textAnchor="middle" fontSize={8} fontWeight="700" fill="white">!</text>
                    </g>
                  )}

                  {/* Avatar circle */}
                  <circle cx={28} cy={NODE_H / 2} r={18}
                    fill={node.isCurrentUser ? 'rgba(255,255,255,0.2)' : color + '18'} />
                  <text x={28} y={NODE_H / 2 + 1}
                    textAnchor="middle" dominantBaseline="middle"
                    fontSize={11} fontWeight="600" fontFamily="system-ui"
                    fill={node.isCurrentUser ? 'white' : color}>
                    {initials}
                  </text>

                  {/* Name */}
                  <text x={52} y={isShepherd ? NODE_H / 2 - 9 : NODE_H / 2 - 4}
                    fontSize={12} fontWeight="600" fontFamily="Georgia, serif"
                    fill={node.isCurrentUser ? 'white' : 'var(--foreground)'}
                    style={{ maxWidth: NODE_W - 60 }}>
                    {node.name.slice(0, 18)}{node.name.length > 18 ? '…' : ''}
                  </text>

                  {/* Shepherd: flock count + context. Member: context label */}
                  {isShepherd ? (
                    <>
                      <text x={52} y={NODE_H / 2 + 6}
                        fontSize={10} fontFamily="system-ui"
                        fill={node.isCurrentUser ? 'rgba(255,255,255,0.75)' : 'var(--muted-foreground)'}>
                        {node.flockCount} in flock
                      </text>
                      <text x={52} y={NODE_H / 2 + 19}
                        fontSize={9} fontFamily="system-ui"
                        fill={node.isCurrentUser ? 'rgba(255,255,255,0.6)' : 'var(--muted-foreground)'}>
                        {node.contextLabel ? node.contextLabel.slice(0, 28) : 'Shepherd'}
                      </text>
                    </>
                  ) : (
                    <text x={52} y={NODE_H / 2 + 9}
                      fontSize={10} fontFamily="system-ui"
                      fill={node.isCurrentUser ? 'rgba(255,255,255,0.75)' : 'var(--muted-foreground)'}>
                      {node.contextLabel ? node.contextLabel.slice(0, 22) : 'Member'}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* Detail panel */}
        {selected && (() => {
          const isShepherd = selected.role === 'shepherd'
          const detailColor = isShepherd ? '#4a7c59' : '#6b7280'
          const initials = selected.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()
          return (
            <div className="absolute right-4 top-4 w-72 bg-white rounded-2xl shadow-xl border p-5"
              style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold sans"
                    style={{ background: detailColor + '20', color: detailColor }}>
                    {initials}
                  </div>
                  <div>
                    <div className="font-serif text-base" style={{ color: 'var(--primary)' }}>
                      {selected.name}
                    </div>
                    <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>
                      {selected.contextLabel || (isShepherd ? 'Shepherd' : 'Member')}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelected(null)}
                  className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>

              {/* Role badge + warning */}
              <div className="flex items-center gap-2 mb-4">
                <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                  style={{ background: detailColor + '15', color: detailColor }}>
                  {isShepherd ? 'Shepherd' : 'Member'}
                </span>
                {selected.warning && (
                  <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                    style={{ background: '#fef3cd', color: '#856404' }}>
                    {selected.warning}
                  </span>
                )}
              </div>

              {isShepherd && (
                <>
                  {/* Stats */}
                  <div className="grid grid-cols-2 gap-3 mb-4">
                    <div className="rounded-xl p-3 text-center" style={{ background: 'var(--muted)' }}>
                      <div className="text-2xl font-serif" style={{ color: 'var(--primary)' }}>{selected.flockCount}</div>
                      <div className="text-xs sans mt-0.5" style={{ color: 'var(--muted-foreground)' }}>In Flock</div>
                    </div>
                    <div className="rounded-xl p-3 text-center" style={{ background: 'var(--muted)' }}>
                      <div className="text-sm font-serif" style={{ color: healthColor(selected) }}>{checkinLabel(selected)}</div>
                      <div className="text-xs sans mt-0.5" style={{ color: 'var(--muted-foreground)' }}>Last Check-in</div>
                    </div>
                  </div>

                  {/* Health indicator */}
                  <div className="rounded-xl p-3 mb-4" style={{ background: 'var(--muted)' }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs sans font-medium" style={{ color: 'var(--foreground)' }}>Flock Health</span>
                      <span className="text-xs sans" style={{ color: healthColor(selected) }}>
                        {selected.flockCount === 0 ? 'No flock assigned' :
                          !selected.lastCheckin ? 'No check-ins' :
                          (Date.now() - new Date(selected.lastCheckin).getTime()) / 86400000 <= 7 ? 'Healthy' :
                          (Date.now() - new Date(selected.lastCheckin).getTime()) / 86400000 <= 30 ? 'Needs attention' : 'At risk'}
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
                      <div className="h-full rounded-full transition-all"
                        style={{
                          width: selected.flockCount === 0 || !selected.lastCheckin ? '0%' :
                            `${Math.max(0, Math.min(100, 100 - ((Date.now() - new Date(selected.lastCheckin).getTime()) / 86400000 / 30 * 100)))}%`,
                          background: healthColor(selected)
                        }} />
                    </div>
                  </div>

                  {/* Assign to shepherd (for unconnected leaders) */}
                  {selected.warning && !connecting && (
                    <button
                      onClick={() => setConnecting({ shepherdId: '', shepherdName: '' })}
                      className="w-full text-xs sans py-2 rounded-lg font-medium mb-3 border-2 border-dashed"
                      style={{ borderColor: '#c17f3e', color: '#c17f3e' }}>
                      Assign a Shepherd
                    </button>
                  )}

                  <div className="flex gap-2">
                    <a href={`/checkins?shepherd=${selected.id}`}
                      className="flex-1 text-center text-xs sans py-2 rounded-lg font-medium"
                      style={{ background: 'var(--primary)', color: 'white' }}>
                      View Check-ins
                    </a>
                    <button
                      onClick={() => setConnecting({ shepherdId: selected.id, shepherdName: selected.name })}
                      className="flex-1 text-center text-xs sans py-2 rounded-lg font-medium border"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                      Add to Flock
                    </button>
                  </div>
                </>
              )}

              {/* Member: assign shepherd */}
              {!isShepherd && !connecting && (
                <div className="flex gap-2">
                  <button
                    onClick={() => setConnecting({ shepherdId: '', shepherdName: '' })}
                    className="flex-1 text-center text-xs sans py-2 rounded-lg font-medium"
                    style={{ background: 'var(--primary)', color: 'white' }}>
                    Assign Shepherd
                  </button>
                </div>
              )}
            </div>
          )
        })()}

        {/* Connection search modal */}
        {connecting && selected && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="w-96 bg-white rounded-2xl shadow-xl border p-5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-serif text-base" style={{ color: 'var(--primary)' }}>
                  {connecting.shepherdId
                    ? `Add to ${connecting.shepherdName}'s flock`
                    : `Assign shepherd for ${selected.name}`}
                </h3>
                <button onClick={() => { setConnecting(null); setSearchTerm(''); setAssignTab('person') }}
                  className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>

              {/* Tabs: Person | Group Type | Service Type (only when adding to a shepherd's flock) */}
              {connecting.shepherdId && ['super_admin', 'staff'].includes(currentUserRole || '') && (
                <div className="flex rounded-lg overflow-hidden border mb-3" style={{ borderColor: 'var(--border)' }}>
                  {([
                    { key: 'person' as const, label: 'Person' },
                    { key: 'group_type' as const, label: 'Group Type' },
                    { key: 'service_type' as const, label: 'Service Type' },
                  ]).map(tab => (
                    <button key={tab.key} onClick={() => setAssignTab(tab.key)}
                      className="flex-1 px-2 py-1.5 text-xs font-medium sans transition-colors"
                      style={{
                        background: assignTab === tab.key ? 'var(--primary)' : 'white',
                        color: assignTab === tab.key ? 'white' : 'var(--muted-foreground)',
                      }}>
                      {tab.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Person search tab */}
              {assignTab === 'person' && (
                <>
                  <input
                    type="text"
                    placeholder="Search by name..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm sans mb-3"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    autoFocus
                  />
                  <div className="max-h-48 overflow-y-auto space-y-1">
                    {allNodes
                      .filter(n => {
                        if (!searchTerm) return false
                        if (n.id === selected.id) return false
                        const matchesSearch = n.name.toLowerCase().includes(searchTerm.toLowerCase())
                        if (connecting.shepherdId) {
                          return matchesSearch
                        } else {
                          return matchesSearch && n.role === 'shepherd'
                        }
                      })
                      .slice(0, 10)
                      .map(n => (
                        <button key={n.id}
                          onClick={() => {
                            if (connecting.shepherdId) {
                              assignShepherd(n.id, connecting.shepherdId)
                            } else {
                              assignShepherd(selected.id, n.id)
                            }
                          }}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium sans shrink-0"
                            style={{ background: n.role === 'shepherd' ? '#4a7c5918' : '#6b728018', color: n.role === 'shepherd' ? '#4a7c59' : '#6b7280' }}>
                            {n.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm sans font-medium" style={{ color: 'var(--foreground)' }}>{n.name}</div>
                            <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>
                              {n.contextLabel || (n.role === 'shepherd' ? 'Shepherd' : 'Member')}
                            </div>
                          </div>
                        </button>
                      ))}
                    {searchTerm && allNodes.filter(n => n.id !== selected.id && n.name.toLowerCase().includes(searchTerm.toLowerCase())).length === 0 && (
                      <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>No matches found</p>
                    )}
                    {!searchTerm && (
                      <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>Type a name to search</p>
                    )}
                  </div>
                </>
              )}

              {/* Group Type bulk assign tab */}
              {assignTab === 'group_type' && connecting.shepherdId && (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  <p className="text-xs sans mb-2" style={{ color: 'var(--muted-foreground)' }}>
                    Assign all members of a group type to {connecting.shepherdName}
                  </p>
                  {groupTypes.length === 0 && (
                    <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>No group types found. Sync from PCO first.</p>
                  )}
                  {groupTypes.map(gt => (
                    <button key={gt.id}
                      disabled={bulkAssigning}
                      onClick={async () => {
                        setBulkAssigning(true)
                        try {
                          const res = await fetch('/api/tree', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'bulk_assign',
                              shepherd_id: connecting.shepherdId,
                              group_type_id: gt.id,
                            }),
                          })
                          const data = await res.json()
                          alert(`Assigned ${data.count || 0} members from "${gt.name}" to ${connecting.shepherdName}`)
                          setConnecting(null)
                          setAssignTab('person')
                          fetchTree()
                        } finally {
                          setBulkAssigning(false)
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-50 transition-colors">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold sans shrink-0"
                        style={{ background: '#4a7c5918', color: '#4a7c59' }}>
                        G
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm sans font-medium truncate" style={{ color: 'var(--foreground)' }}>{gt.name}</div>
                        <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>
                          {gt.is_tracked ? 'Tracked' : 'Not tracked'}
                        </div>
                      </div>
                      {bulkAssigning && <span className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Assigning…</span>}
                    </button>
                  ))}
                </div>
              )}

              {/* Service Type bulk assign tab */}
              {assignTab === 'service_type' && connecting.shepherdId && (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  <p className="text-xs sans mb-2" style={{ color: 'var(--muted-foreground)' }}>
                    Assign all members of a service type to {connecting.shepherdName}
                  </p>
                  {serviceTypes.length === 0 && (
                    <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>No service types found. Sync from PCO first.</p>
                  )}
                  {serviceTypes.map(st => (
                    <button key={st.id}
                      disabled={bulkAssigning}
                      onClick={async () => {
                        setBulkAssigning(true)
                        try {
                          const res = await fetch('/api/tree', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'bulk_assign',
                              shepherd_id: connecting.shepherdId,
                              service_type_id: st.id,
                            }),
                          })
                          const data = await res.json()
                          alert(`Assigned ${data.count || 0} members from "${st.name}" to ${connecting.shepherdName}`)
                          setConnecting(null)
                          setAssignTab('person')
                          fetchTree()
                        } finally {
                          setBulkAssigning(false)
                        }
                      }}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-50 transition-colors">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold sans shrink-0"
                        style={{ background: '#3b6ea518', color: '#3b6ea5' }}>
                        S
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm sans font-medium truncate" style={{ color: 'var(--foreground)' }}>{st.name}</div>
                        <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Service Type</div>
                      </div>
                      {bulkAssigning && <span className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Assigning…</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Add person modal */}
        {addingPerson && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="w-96 bg-white rounded-2xl shadow-xl border p-5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-serif text-base" style={{ color: 'var(--primary)' }}>Add Person to Tree</h3>
                <button onClick={() => { setAddingPerson(false); setAddSearch(''); setAddResults([]) }}
                  className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>
              <p className="text-xs sans mb-3" style={{ color: 'var(--muted-foreground)' }}>
                Search for anyone in your congregation. Choose a shepherd to place them under, or add them as a root leader.
              </p>
              <input
                type="text"
                placeholder="Search by name..."
                value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm sans mb-3"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                autoFocus
              />
              <div className="max-h-64 overflow-y-auto space-y-1">
                {addResults.map(p => {
                  const alreadyInTree = allNodes.some(n => n.id === p.id)
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2 rounded-lg" style={{ background: alreadyInTree ? 'var(--muted)' : 'white' }}>
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium sans shrink-0"
                        style={{ background: '#4a7c5918', color: '#4a7c59' }}>
                        {p.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm sans font-medium truncate" style={{ color: 'var(--foreground)' }}>{p.name}</div>
                        {alreadyInTree && <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Already in tree</div>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        <button
                          onClick={() => addPersonToTree(p.id)}
                          className="text-xs sans px-2 py-1 rounded font-medium"
                          style={{ background: 'var(--primary)', color: 'white' }}>
                          As Root
                        </button>
                        <select
                          className="text-xs sans px-1 py-1 rounded border"
                          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                          defaultValue=""
                          onChange={e => { if (e.target.value) addPersonToTree(p.id, e.target.value) }}>
                          <option value="" disabled>Under…</option>
                          {allNodes.filter(n => n.role === 'shepherd').slice(0, 20).map(n => (
                            <option key={n.id} value={n.id}>{n.name}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )
                })}
                {addSearch.length >= 2 && addResults.length === 0 && (
                  <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>No matches</p>
                )}
                {addSearch.length < 2 && (
                  <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>Type at least 2 characters to search</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

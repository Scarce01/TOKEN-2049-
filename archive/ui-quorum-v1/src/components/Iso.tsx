import type { ReactNode } from 'react'
import type { Status } from './ui'

/** Isometric hex prism for SVG diagrams. Status drives intensity, never hue. */
const SQ = 0.56
export function isoPts(x: number, y: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => [x + r * Math.cos((Math.PI / 3) * i), y + r * Math.sin((Math.PI / 3) * i) * SQ] as const)
}
const str = (p: readonly (readonly [number, number])[]) => p.map((v) => v.join(',')).join(' ')

const LOOK: Record<Status, { top: string; side: string; stroke: string; sw: number; dash?: string; glow?: boolean }> = {
  idle: { top: '#1a1b20', side: '#111216', stroke: 'rgba(255,241,193,.10)', sw: 1 },
  active: { top: '#23221d', side: '#17171a', stroke: '#FFC700', sw: 1.2 },
  warning: { top: '#2a2416', side: '#1a1712', stroke: '#FCAD17', sw: 1.4, dash: '5 3' },
  threat: { top: '#FACF30', side: '#a77f0c', stroke: '#FACF30', sw: 2, glow: true },
}

export function IsoHex({ x, y, r, depth = r * 0.35, status = 'idle', selected, hovered, onClick, onHover, children, label, sub }: {
  x: number; y: number; r: number; depth?: number; status?: Status; selected?: boolean; hovered?: boolean
  onClick?: () => void; onHover?: (h: boolean) => void; children?: ReactNode; label?: string; sub?: string
}) {
  const L = LOOK[status]
  const v = isoPts(x, y, r)
  const faces = [[0, 1], [1, 2], [2, 3]].map(([i, j]) => [v[i], v[j], [v[j][0], v[j][1] + depth], [v[i][0], v[i][1] + depth]] as const)
  return (
    <g className={onClick ? 'cursor-pointer' : ''} onClick={onClick} onMouseEnter={() => onHover?.(true)} onMouseLeave={() => onHover?.(false)}>
      {/* soft cast shadow, same light direction as the 3D world (from upper left) */}
      <polygon points={str(isoPts(x + depth * 0.6, y + depth + 6, r * 1.02))} fill="#000" opacity={0.35} style={{ filter: 'blur(4px)' }} />
      {(selected || hovered) && <polygon points={str(isoPts(x, y + depth, r + 10))} fill="none" stroke="#FFF1C1" strokeOpacity={selected ? 0.8 : 0.35} strokeWidth="1.2" />}
      {L.glow && <polygon points={str(v)} fill="none" stroke="#FACF30" strokeWidth="2" className="pulse-ring" />}
      {faces.map((f, k) => <polygon key={k} points={str(f as never)} fill={L.side} stroke={L.stroke} strokeOpacity={0.4} strokeWidth={0.8} style={{ filter: k === 1 ? 'brightness(.75)' : undefined }} />)}
      <polygon points={str(v)} fill={L.top} stroke={L.stroke} strokeWidth={selected ? L.sw + 1 : L.sw} strokeDasharray={L.dash} />
      {/* low-poly facets: lit upper-left half, shaded lower-right */}
      <polygon points={str([[x, y], v[3], v[4], v[5]] as never)} fill="#FFF1C1" opacity={status === 'threat' ? 0.18 : 0.035} />
      <polygon points={str([[x, y], v[0], v[1], v[2]] as never)} fill="#000" opacity={0.12} />
      {children}
      {label && <text x={x} y={y + r * SQ + depth + 17} textAnchor="middle" fontSize="12.5" fontWeight="600" fill={status === 'idle' ? '#8f8a7a' : '#FFF1C1'}>{label}</text>}
      {sub && <text x={x} y={y + r * SQ + depth + 31} textAnchor="middle" fontSize="10" letterSpacing=".6" fill={status === 'threat' ? '#FACF30' : '#8f8a7a'} className="font-mono">{sub.toUpperCase()}</text>}
    </g>
  )
}

/** Honey-flow route between two points; `live` animates, `focus` brightens */
export function Flow({ a, b, kind = 'defense', live = true, focus, dim, bend = -40 }: { a: [number, number]; b: [number, number]; kind?: 'defense' | 'attack' | 'request' | 'intel'; live?: boolean; focus?: boolean; dim?: boolean; bend?: number }) {
  const color = kind === 'attack' ? '#FCAD17' : kind === 'request' ? '#8f8a7a' : kind === 'intel' ? '#FFF1C1' : '#FFC700'
  const d = `M${a[0]},${a[1]} Q${(a[0] + b[0]) / 2},${(a[1] + b[1]) / 2 + bend} ${b[0]},${b[1]}`
  return (
    <g opacity={dim ? 0.15 : 1} className="transition-opacity duration-300">
      <path d={d} fill="none" stroke={color} strokeOpacity={0.2} strokeWidth={focus ? 6 : 4} />
      <path d={d} fill="none" stroke={color} strokeOpacity={0.45} strokeWidth="1.3" strokeDasharray={kind === 'attack' || kind === 'request' ? '5 5' : undefined} />
      {live && <path d={d} fill="none" stroke={color} strokeWidth={focus ? 2.6 : 1.8} className={kind === 'request' ? 'flow-slow' : 'flow'} />}
    </g>
  )
}

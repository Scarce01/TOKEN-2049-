'use client'
// three.js hex terrain. Owns the WebGL scene; everything it shows comes from props, so the page can feed live data.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { type Cell, EXCHANGES, heightAt, R, type Replay, stateAt, TIERS } from '@/lib/observatory'

export type TerrainHandle = {
  zoomBy(f: number): void
  panBy(x: number, z: number): void
  reset(): void
  focus(c: Cell): void
}
type Props = {
  cells: Cell[]
  replay: Replay
  ctx: { threat: Cell; vault: Cell; target: Cell }
  time: number
  selected: Cell
  masked: boolean
  topView: boolean
  onSelect(c: Cell): void
  onZoom(z: number): void
}

type Scene = {
  draw(): void
  zoomBy(f: number): void
  panBy(x: number, z: number): void
  reset(top: boolean): void
  focus(c: Cell): void
  dispose(): void
}

function makeLabel(layer: HTMLElement, text: string, style = '') {
  const el = document.createElement('div')
  el.textContent = text
  el.style.cssText = `position:absolute;white-space:nowrap;transform:translate(-50%,-100%);font:10px Consolas,monospace;color:#c1cbce;padding:7px 10px;background:#151b1eed;border:1px solid #48545b;border-radius:4px;box-shadow:0 5px 15px #0003;${style}`
  layer.append(el)
  return el
}

function createScene(canvas: HTMLCanvasElement, layer: HTMLElement, init: Props, propsRef: { current: Props }): Scene {
  const { cells, ctx } = init
  const reduce = matchMedia('(prefers-reduced-motion: reduce)')
  let width = 1
  let height = 1
  const scene = new THREE.Scene()
  scene.background = new THREE.Color('#171c20')
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  const camera = new THREE.OrthographicCamera(-550, 550, 350, -350, 1, 6000)
  const controls = new OrbitControls(camera, canvas)
  Object.assign(controls, {
    enableDamping: false,
    screenSpacePanning: false,
    minZoom: 0.22,
    maxZoom: 3.8,
    maxTargetRadius: 2000,
    minPolarAngle: 0.15,
    maxPolarAngle: Math.PI * 0.39,
    minAzimuthAngle: -0.8,
    maxAzimuthAngle: 0.8,
    zoomToCursor: true,
  })
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
  controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE }

  scene.add(new THREE.HemisphereLight('#e1e7ed', '#222933', 1.7))
  const sun = new THREE.DirectionalLight('#fff3e4', 3)
  sun.position.set(-450, 700, -200)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -850, right: 850, top: 850, bottom: -850, near: 1, far: 2000 })
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.65
  scene.add(sun)
  const fill = new THREE.DirectionalLight('#9eafc1', 0.7)
  fill.position.set(300, 200, -450)
  scene.add(fill)
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(9000, 9000),
    new THREE.MeshStandardMaterial({
      color: '#122b35',
      emissive: '#10232b',
      emissiveIntensity: 0.3,
      roughness: 0.48,
      metalness: 0.3,
    }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.position.y = -1
  floor.receiveShadow = true
  scene.add(floor)

  const shape = new THREE.Shape()
  for (let i = 0; i < 6; i++) {
    const a = (i * Math.PI) / 3
    const [x, y] = [Math.cos(a) * R * 0.968, Math.sin(a) * R * 0.968]
    if (i) shape.lineTo(x, y)
    else shape.moveTo(x, y)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    steps: 1,
    bevelSize: 0.25,
    bevelThickness: 0.014,
  })
  geometry.rotateX(-Math.PI / 2)
  const columns = new THREE.InstancedMesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: '#81888e', roughness: 0.78, metalness: 0.16 }),
    cells.length,
  )
  columns.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  columns.castShadow = true
  columns.receiveShadow = true
  columns.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 80, 0), 3200)
  scene.add(columns)
  const dummy = new THREE.Object3D()
  const color = new THREE.Color()
  for (const c of cells) {
    color.setHSL(0.57, c.served ? 0.045 : 0.025, (c.served ? 0.43 : 0.15) + ((c.index * 7) % 9) / 300)
    columns.setColorAt(c.index - 1, color)
  }

  const honey = new THREE.MeshStandardMaterial({
    color: '#bd7d24',
    emissive: '#ff951d',
    emissiveIntensity: 0.35,
    roughness: 0.35,
    metalness: 0.18,
  })
  const gc = document.createElement('canvas')
  gc.width = gc.height = 128
  const g2 = gc.getContext('2d')!
  const grad = g2.createRadialGradient(64, 64, 0, 64, 64, 64)
  grad.addColorStop(0, 'rgba(255,173,57,.48)')
  grad.addColorStop(0.3, 'rgba(243,144,28,.2)')
  grad.addColorStop(1, 'rgba(243,144,28,0)')
  g2.fillStyle = grad
  g2.fillRect(0, 0, 128, 128)
  const glowTex = new THREE.CanvasTexture(gc)
  const glowMat = new THREE.SpriteMaterial({
    map: glowTex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.5,
  })
  const decoys = cells
    .filter((c) => c.kind === 'decoy')
    .map((cell) => {
      const mesh = new THREE.Mesh(geometry, honey)
      mesh.castShadow = true
      const light = new THREE.PointLight('#ffb84e', 1900, 90, 2)
      const glow = new THREE.Sprite(glowMat)
      glow.scale.set(95, 95, 1)
      scene.add(mesh, light, glow)
      return { cell, mesh, light, glow }
    })
  const ring = Array.from(
    { length: 6 },
    (_, i) => new THREE.Vector3(Math.cos((i * Math.PI) / 3) * R * 0.97, 0, Math.sin((i * Math.PI) / 3) * R * 0.97),
  )
  const selection = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(ring),
    new THREE.LineBasicMaterial({ color: '#f4d298' }),
  )
  scene.add(selection)
  const { threat, vault, target } = ctx
  const path = new THREE.CatmullRomCurve3([
    new THREE.Vector3(threat.x, 42, threat.y),
    new THREE.Vector3(-40, 90, 20),
    new THREE.Vector3(120, 75, 50),
    new THREE.Vector3(target.x, 110, target.y),
  ])
  const link = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints(path.getPoints(75)),
    new THREE.LineDashedMaterial({ color: '#c0cdc5', dashSize: 2, gapSize: 8, transparent: true, opacity: 0.55 }),
  )
  link.computeLineDistances()
  scene.add(link)

  const regionLabels = EXCHANGES.map((e) => ({
    e,
    el: makeLabel(
      layer,
      `${e.name.toUpperCase()} / ${e.served ? 'CONNECTED' : 'NOT CONNECTED'}`,
      `color:${e.served ? '#d5dddf' : '#99a1a5'};background:#141a20d9;font:11px Arial;`,
    ),
  }))
  const tierLabels = EXCHANGES.flatMap((e) =>
    TIERS.map((t) => ({
      cell: cells.find((c) => c.q === e.q && c.r === e.r + t.dr),
      el: makeLabel(
        layer,
        `${t.name.toUpperCase()} / ${e.id}${e.served ? '' : ' / SCHEMATIC'}`,
        'font:9px Consolas,monospace;color:#bfcbd0;background:#131a20dd',
      ),
    })),
  ).filter((t): t is { cell: Cell; el: HTMLDivElement } => !!t.cell)
  const vaultLabel = makeLabel(layer, '')
  const threatLabel = makeLabel(layer, '', 'color:#edb5a1')
  const marker = makeLabel(
    layer,
    '▼',
    'background:transparent;border:0;color:#f7816b;font-size:26px;padding:0;text-shadow:0 2px 10px #000;',
  )
  const shareLabel = makeLabel(layer, '', 'color:#bdcfc1')

  const project = (el: HTMLElement, x: number, y: number, z: number, visible = true) => {
    const p = new THREE.Vector3(x, y, z).project(camera)
    const sx = (p.x * 0.5 + 0.5) * width
    const sy = (-p.y * 0.5 + 0.5) * height
    el.hidden = !visible || p.z < -1 || p.z > 1 || sx < 85 || sx > width - 85 || sy < 68 || sy > height - 85
    el.style.left = `${sx}px`
    el.style.top = `${sy}px`
  }

  let terrainTime = -1
  let raf = 0
  const draw = (p: Props) => {
    const { replay: rp, time, masked, selected } = p
    const s = stateAt(rp, time)
    const h = (c: Cell) => heightAt(c, time, rp, ctx, !reduce.matches)
    if (terrainTime !== time) {
      for (const c of cells) {
        dummy.position.set(c.x, 0, c.y)
        dummy.scale.set(1, h(c), 1)
        dummy.updateMatrix()
        columns.setMatrixAt(c.index - 1, dummy.matrix)
      }
      columns.instanceMatrix.needsUpdate = true
      terrainTime = time
    }
    for (const d of decoys) {
      const dh = h(d.cell)
      d.mesh.position.set(d.cell.x, 0.1, d.cell.y)
      d.mesh.scale.set(1.012, dh, 1.012)
      d.light.position.set(d.cell.x, dh + 9, d.cell.y)
      d.glow.position.set(d.cell.x, dh + 3, d.cell.y)
      d.mesh.visible = d.light.visible = d.glow.visible = !masked
    }
    selection.position.set(selected.x, h(selected) + 1, selected.y)
    selection.material.color.set(masked ? '#d4dcdf' : '#f4d298')
    link.visible = s.frozen
    link.material.opacity = s.shared ? 0.55 : 0.18
    renderer.render(scene, camera)
    for (const { e, el } of regionLabels) project(el, (e.q - 18.5) * R * 1.5, 285, (e.r - 12.5) * R * Math.sqrt(3))
    for (const { cell: c, el } of tierLabels)
      project(el, c.x, h(c) + 14, c.y, camera.zoom >= 0.7 && !(c.exchange === rp.frozenExchange && c.tier === 'Hot'))
    vaultLabel.textContent = `HOT ${rp.frozenExchange} / ${s.frozen ? 'LIMIT 0' : 'ARMED'}`
    project(vaultLabel, vault.x, h(vault) + 18, vault.y)
    threatLabel.textContent = `${rp.caseLabel} · +${Math.max(0, time - rp.hitAt).toFixed(1)}s`
    project(threatLabel, threat.x, h(threat) + 65, threat.y, s.hit)
    project(marker, threat.x, h(threat) + 18, threat.y, s.hit)
    shareLabel.textContent = `${rp.sharedExchange} · THREAT RECEIVED`
    project(shareLabel, target.x, h(target) + 24, target.y, s.shared)
  }
  const invalidate = () => {
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0
        draw(propsRef.current)
      })
  }
  controls.addEventListener('change', () => {
    propsRef.current.onZoom(camera.zoom)
    invalidate()
  })

  const resize = () => {
    const rect = canvas.getBoundingClientRect()
    width = rect.width
    height = rect.height
    const span = Math.max(1000, (1800 * height) / width)
    const aspect = width / height
    Object.assign(camera, { left: (-span * aspect) / 2, right: (span * aspect) / 2, top: span / 2, bottom: -span / 2 })
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    invalidate()
  }
  const ro = new ResizeObserver(resize)
  ro.observe(canvas)

  // click (not drag) picks a column
  const raycaster = new THREE.Raycaster()
  const mouse = new THREE.Vector2()
  let ptr: { id: number; x: number; y: number; moved: boolean } | null = null
  const down = (e: PointerEvent) => {
    canvas.focus({ preventScroll: true })
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: e.button !== 0 }
  }
  const move = (e: PointerEvent) => {
    if (ptr && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 5) ptr.moved = true
  }
  const up = (e: PointerEvent) => {
    if (ptr && ptr.id === e.pointerId && !ptr.moved) {
      const rect = canvas.getBoundingClientRect()
      mouse.set(((e.clientX - rect.left) / width) * 2 - 1, -((e.clientY - rect.top) / height) * 2 + 1)
      raycaster.setFromCamera(mouse, camera)
      const hit = raycaster.intersectObject(columns)[0]
      if (hit?.instanceId !== undefined) propsRef.current.onSelect(cells[hit.instanceId])
    }
    ptr = null
  }
  canvas.addEventListener('pointerdown', down)
  canvas.addEventListener('pointermove', move)
  canvas.addEventListener('pointerup', up)
  reduce.addEventListener('change', () => {
    terrainTime = -1
    invalidate()
  })

  const zoomBy = (f: number) => {
    camera.zoom = Math.max(0.22, Math.min(3.8, camera.zoom * f))
    camera.updateProjectionMatrix()
    controls.update()
  }
  const panBy = (x: number, z: number) => {
    const d = new THREE.Vector3(x, 0, z)
    camera.position.add(d)
    controls.target.add(d)
    controls.update()
  }
  const reset = (top: boolean) => {
    camera.zoom = 1
    controls.target.set(0, 0, 0)
    controls.enableRotate = !top
    controls.minPolarAngle = top ? 0 : 0.15
    camera.position.set(top ? 0 : 230, top ? 1000 : 920, top ? 0.01 : 850)
    camera.updateProjectionMatrix()
    controls.update()
  }
  const focus = (c: Cell) => {
    const off = camera.position.clone().sub(controls.target)
    controls.target.set(c.x, 0, c.y)
    camera.position.copy(controls.target).add(off)
    controls.update()
  }
  reset(init.topView)
  return {
    draw: invalidate,
    zoomBy,
    panBy,
    reset,
    focus,
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      canvas.removeEventListener('pointerdown', down)
      canvas.removeEventListener('pointermove', move)
      canvas.removeEventListener('pointerup', up)
      controls.dispose()
      geometry.dispose()
      glowTex.dispose()
      renderer.dispose()
      layer.replaceChildren()
    },
  }
}

export const HexTerrain = forwardRef<TerrainHandle, Props>(function HexTerrain(props, ref) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const layer = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const s = useRef<Scene | null>(null)

  // Scene is rebuilt only when the terrain itself changes; time/selection/mask are redraws.
  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild on cells/ctx only
  useEffect(() => {
    s.current = createScene(canvas.current!, layer.current!, propsRef.current, propsRef)
    return () => s.current?.dispose()
  }, [props.cells, props.ctx])

  useEffect(() => {
    s.current?.draw()
  })
  useEffect(() => {
    s.current?.reset(props.topView)
  }, [props.topView])

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => s.current?.zoomBy(f),
    panBy: (x, z) => s.current?.panBy(x, z),
    reset: () => s.current?.reset(propsRef.current.topView),
    focus: (c) => s.current?.focus(c),
  }))

  const key = (e: React.KeyboardEvent) => {
    const shift: Record<string, [number, number]> = {
      ArrowLeft: [-35, 0],
      ArrowRight: [35, 0],
      ArrowUp: [0, -35],
      ArrowDown: [0, 35],
    }
    const sc = s.current
    if (!sc) return
    if (shift[e.key]) sc.panBy(...shift[e.key])
    else if (e.key === '+' || e.key === '=') sc.zoomBy(1.2)
    else if (e.key === '-') sc.zoomBy(1 / 1.2)
    else if (e.key === 'Home') sc.reset(props.topView)
    else return
    e.preventDefault()
  }

  return (
    <>
      <canvas
        ref={canvas}
        tabIndex={0}
        onKeyDown={key}
        onContextMenu={(e) => e.preventDefault()}
        className="absolute inset-0 block h-full w-full cursor-grab touch-none"
        aria-label="3D network map. Drag or use arrow keys to pan, right-drag to orbit, plus and minus to zoom."
      />
      <div ref={layer} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </>
  )
})

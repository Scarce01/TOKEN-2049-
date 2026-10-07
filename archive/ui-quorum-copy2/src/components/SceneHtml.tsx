import { useEffect, useMemo, useRef, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { useFrame, useThree } from "@react-three/fiber"
import * as THREE from "three"

type SceneHtmlProps = {
  children: ReactNode
  position: [number, number, number]
  center?: boolean
  distanceFactor?: number
  zIndexRange?: [number, number]
}

export default function SceneHtml({
  children,
  position,
  center = false,
  distanceFactor,
  zIndexRange = [20, 0],
}: SceneHtmlProps) {
  const { gl, size, camera } = useThree()
  const group = useRef<THREE.Group>(null)
  const mount = useRef<{
    element: HTMLDivElement
    root: Root
  } | null>(null)
  const point = useMemo(() => new THREE.Vector3(), [])
  const cameraPosition = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => {
    const parent = gl.domElement.parentElement
    if (!parent) return

    const element = document.createElement("div")
    element.className = "absolute left-0 top-0 origin-top-left"
    element.style.visibility = "hidden"
    const root = createRoot(element)
    const current = { element, root }
    mount.current = current
    parent.appendChild(element)

    return () => {
      if (mount.current === current) mount.current = null
      element.style.visibility = "hidden"
      queueMicrotask(() => {
        try {
          root.unmount()
        } finally {
          element.remove()
        }
      })
    }
  }, [gl])

  useEffect(() => {
    mount.current?.root.render(
      <div className={center ? "-translate-x-1/2 -translate-y-1/2" : undefined}>
        {children}
      </div>,
    )
  }, [children, center, gl])

  useFrame(() => {
    const element = mount.current?.element
    if (!element || !group.current) return

    camera.updateMatrixWorld()
    group.current.updateWorldMatrix(true, false)
    point.setFromMatrixPosition(group.current.matrixWorld)
    camera.getWorldPosition(cameraPosition)
    const distance = point.distanceTo(cameraPosition)
    let scale = 1
    if (distanceFactor !== undefined) {
      if (camera instanceof THREE.PerspectiveCamera) {
        scale =
          distanceFactor /
          (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance)
      } else if (camera instanceof THREE.OrthographicCamera) {
        scale = distanceFactor * camera.zoom
      }
    }
    point.project(camera)
    const visible = point.z >= -1 && point.z <= 1
    element.style.visibility = visible ? "visible" : "hidden"
    if (!visible) return

    const horizontal = ((point.x + 1) * size.width) / 2
    const vertical = ((1 - point.y) * size.height) / 2
    element.style.transform = `translate3d(${horizontal}px, ${vertical}px, 0) scale(${scale})`
    element.style.zIndex = String(
      Math.round(
        THREE.MathUtils.lerp(
          zIndexRange[0],
          zIndexRange[1],
          THREE.MathUtils.clamp(
            (distance - camera.near) / (camera.far - camera.near),
            0,
            1,
          ),
        ),
      ),
    )
  })

  return <group ref={group} position={position} />
}

import React from 'react'
import { Shape } from 'react-konva'
import type { Context } from 'konva/lib/Context'
import type { Point2 } from '@/types/schema'

interface MergedWallVolumeShapeProps {
  paths: Point2[][]
  outlinePaths?: Point2[][]
  fill: string
  stroke?: string
  strokeWidth?: number
}

/**
 * Konva reports a custom-drawn Shape without an explicit size as an empty box at the
 * origin, which drags fit-to-view and export bounds to (0, 0). Give each Shape the
 * real bounding box of its paths, positioned there, and draw relative to it.
 */
function getPathsBounds(paths: Point2[][]): { x: number; y: number; width: number; height: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const path of paths) {
    if (path.length < 3) continue
    for (const point of path) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

export function MergedWallVolumeShape({
  paths,
  outlinePaths = paths,
  fill,
  stroke,
  strokeWidth,
}: MergedWallVolumeShapeProps) {
  if (paths.length === 0) return null

  const fillBounds = getPathsBounds(paths)
  const outlineBounds = getPathsBounds(outlinePaths)

  const drawPaths = (
    context: Context,
    drawPathsValue: Point2[][],
    origin: { x: number; y: number }
  ) => {
    context.beginPath()
    for (const path of drawPathsValue) {
      if (path.length < 3) continue
      const first = path[0]
      if (!first) continue
      context.moveTo(first.x - origin.x, first.y - origin.y)
      for (let index = 1; index < path.length; index += 1) {
        const point = path[index]
        if (!point) continue
        context.lineTo(point.x - origin.x, point.y - origin.y)
      }
      context.closePath()
    }
  }

  return (
    <>
      <Shape
        listening={false}
        x={fillBounds.x}
        y={fillBounds.y}
        width={fillBounds.width}
        height={fillBounds.height}
        fill={fill}
        perfectDrawEnabled={false}
        sceneFunc={(context, shape) => {
          drawPaths(context, paths, fillBounds)
          context.fillShape(shape)
        }}
      />
      <Shape
        listening={false}
        x={outlineBounds.x}
        y={outlineBounds.y}
        width={outlineBounds.width}
        height={outlineBounds.height}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineJoin="miter"
        perfectDrawEnabled={false}
        sceneFunc={(context, shape) => {
          drawPaths(context, outlinePaths, outlineBounds)
          context.strokeShape(shape)
        }}
      />
    </>
  )
}

export default React.memo(MergedWallVolumeShape)

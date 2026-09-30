'use strict'

// Renders a converted LibreDWG database as one clean SVG per paper-space
// viewport. Architectural DWGs commonly stack several floors on top of each
// other in model space and separate them only through per-viewport frozen
// layers, so rendering model space as a whole produces an unreadable overlay.
// Every view stays in model-space coordinates (outer matrix(1,0,0,-1,0,0)),
// which keeps CAD unit scaling and the CAD reference pipeline unchanged.
//
// Entity groups carry data-layer so the client can toggle layers without a
// server round-trip. Layers that are off, frozen or not plotted are still
// rendered but reported as initially hidden; Defpoints and layers frozen in the
// viewport (usually other floors) are never rendered. Block contents on layer
// "0" carry no data-layer: they follow the layer of their insert.
//
// Keep this file identical in netlify/functions and netlify/functions-offline.

const { SvgConverter, Box2D, interpolatePolyline } = require('./_libredwg-js-svg-converter.cjs')

const MODEL_SPACE = '*MODEL_SPACE'
const PAPER_SPACE_PREFIX = '*PAPER_SPACE'
const VIEWPORT_OFF_FLAG = 0x20000
const DWG_TYPE_VIEWPORT = 34
const PATTERN_HATCH_OPACITY = 0.2
const ARC_SEGMENT_RADIANS = Math.PI / 36
// Solid fills (wall poché, SOLID entities, hatches) make plans hard to trace over,
// so they are tagged and hidden by default. Removing CAD_FILL_STYLE shows them again.
const CAD_FILL_CLASS = 'cad-fill'
const CAD_FILL_STYLE = `<style>.${CAD_FILL_CLASS}{fill:none!important}</style>`
const FILLED_ENTITY_TYPES = new Set(['TEXT', 'MTEXT', 'SOLID', 'TRACE', 'HATCH', 'INSERT', 'DIMENSION'])

const upper = (value) => String(value ?? '').toUpperCase()
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function pointsToPathData(points, closed) {
  const d = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`).join('')
  return closed ? `${d}Z` : d
}

function boxFromPoints(points) {
  const box = new Box2D()
  for (const point of points) {
    if (isFiniteNumber(point?.x) && isFiniteNumber(point?.y)) box.expandByPoint(point)
  }
  return box
}

function sampleArc(center, radius, startAngle, endAngle, counterClockwise = true) {
  let start = startAngle
  let end = endAngle
  if (!counterClockwise) {
    start = -startAngle
    end = -endAngle
  }
  if (counterClockwise ? end < start : end > start) end += counterClockwise ? Math.PI * 2 : -Math.PI * 2
  const steps = Math.max(2, Math.ceil(Math.abs(end - start) / ARC_SEGMENT_RADIANS))
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const angle = start + ((end - start) * i) / steps
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) })
  }
  return points
}

function sampleEllipse(center, majorAxis, ratio, startAngle, endAngle, counterClockwise = true) {
  const minorAxis = { x: -majorAxis.y * ratio, y: majorAxis.x * ratio }
  let start = startAngle
  let end = endAngle
  if (!counterClockwise) {
    start = -startAngle
    end = -endAngle
  }
  if (counterClockwise ? end < start : end > start) end += counterClockwise ? Math.PI * 2 : -Math.PI * 2
  const steps = Math.max(2, Math.ceil(Math.abs(end - start) / ARC_SEGMENT_RADIANS))
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const t = start + ((end - start) * i) / steps
    points.push({
      x: center.x + majorAxis.x * Math.cos(t) + minorAxis.x * Math.sin(t),
      y: center.y + majorAxis.y * Math.cos(t) + minorAxis.y * Math.sin(t),
    })
  }
  return points
}

/** Layers never rendered: Defpoints only holds construction points. */
function getExcludedLayers() {
  return new Set(['DEFPOINTS'])
}

/** Layers rendered for toggling but hidden initially: off, frozen, or not plotted. */
function getInitiallyHiddenLayers(db) {
  const hidden = new Set()
  for (const layer of db?.tables?.LAYER?.entries ?? []) {
    if (layer.off || layer.frozen || layer.plotFlag === 0) hidden.add(upper(layer.name))
  }
  return hidden
}

class LayerAwareSvgConverter extends SvgConverter {
  constructor(db, excludedLayers, initiallyHiddenLayers = new Set()) {
    super()
    this.db = db
    this.excludedLayers = excludedLayers
    this.initiallyHiddenLayers = initiallyHiddenLayers
    this.layers = db?.tables?.LAYER?.entries ?? []
    this.layerRecords = new Map(this.layers.map((layer) => [upper(layer.name), layer]))
    this.blockRecords = new Map((db?.tables?.BLOCK_RECORD?.entries ?? []).map((block) => [block.name, block]))
    this.blocksInProgress = new Set()
    this.blockLayers = new Map()
    this.defs = []
  }

  isEntityHidden(entity) {
    return entity?.isVisible === false || this.excludedLayers.has(upper(entity?.layer))
  }

  /** Layer table spelling of an entity layer; CAD layer names are case-insensitive. */
  layerName(entity) {
    const raw = String(entity?.layer ?? '') || '0'
    return String(this.layerRecords.get(upper(raw))?.name ?? raw)
  }

  isLayerInitiallyVisible(name) {
    return !this.initiallyHiddenLayers.has(upper(name))
  }

  /** Legend entry for a layer: its ByLayer colour and whether it starts visible. */
  describeLayer(name) {
    // A negative colour index only marks the layer as off.
    const colorIndex = Math.abs(Number(this.layerRecords.get(upper(name))?.colorIndex ?? 7)) || 7
    const color = this.getEntityColor([{ name, colorIndex }], { layer: name, colorIndex: 256 }).cssColor
    return { name, color, visible: this.isLayerInitiallyVisible(name) }
  }

  /** Builds block definitions lazily so only blocks reachable from the view are emitted. */
  ensureBlock(name) {
    if (this.blockMap.has(name)) return this.blockMap.get(name)
    const record = this.blockRecords.get(name)
    if (!record || this.blocksInProgress.has(name)) return null
    this.blocksInProgress.add(name)
    const item = this.block(record)
    this.blocksInProgress.delete(name)
    this.blockMap.set(name, item)
    if (item) this.blockLayers.set(name, item.layers)
    if (item) this.defs.push(item.element)
    return item
  }

  lines(lines, fontsize, insertionPoint, extentsWidth, anchor = 'start') {
    const result = super.lines(lines.map(escapeXml), fontsize, insertionPoint, extentsWidth, anchor)
    // CAD text is filled only; an inherited stroke makes glyphs look bloated.
    return { ...result, element: `<g stroke="none" font-family="Arial, Helvetica, sans-serif">${result.element}</g>` }
  }

  rotateTextElement(result, angle, point) {
    if (!result || !angle) return result
    const degrees = (angle * 180) / Math.PI
    return {
      bbox: result.bbox.clone().rotate(angle, point),
      element: `<g transform="rotate(${degrees},${point.x},${point.y})">${result.element}</g>`,
    }
  }

  text(entity) {
    const fontsize = entity.textHeight
    const text = String(entity.text ?? '')
    if (!text || !isFiniteNumber(fontsize) || fontsize <= 0) return null
    const aligned = (entity.halign || entity.valign) && entity.endPoint && (entity.endPoint.x || entity.endPoint.y)
    const point = aligned ? entity.endPoint : entity.startPoint
    if (!point) return null
    let anchor = 'start'
    if (entity.halign === 1 || entity.halign === 4) anchor = 'middle'
    else if (entity.halign === 2) anchor = 'end'
    const width = text.length * fontsize * 0.6
    return this.rotateTextElement(this.lines([text], fontsize, point, width, anchor), entity.rotation, point)
  }

  mtext(entity) {
    const fontsize = entity.textHeight
    const insertionPoint = entity.insertionPoint
    if (!insertionPoint || !isFiniteNumber(fontsize) || fontsize <= 0) return null
    const lines = this.extractMTextLines(String(entity.text ?? ''))
    if (lines.length === 0) return null
    const attachment = Number(entity.attachmentPoint) || 1
    const column = (attachment - 1) % 3
    const row = Math.floor((attachment - 1) / 3)
    const anchor = column === 1 ? 'middle' : column === 2 ? 'end' : 'start'
    const blockHeight = (lines.length - 1) * fontsize * 1.5
    const firstBaselineY =
      row === 0
        ? insertionPoint.y - fontsize
        : row === 1
          ? insertionPoint.y + blockHeight / 2 - fontsize / 2
          : insertionPoint.y + blockHeight
    const width = entity.extentsWidth || Math.max(...lines.map((line) => line.length)) * fontsize * 0.6
    const result = this.lines(lines, fontsize, { x: insertionPoint.x, y: firstBaselineY }, width, anchor)
    const direction = entity.direction
    const angle =
      direction && (direction.x || direction.y) ? Math.atan2(direction.y, direction.x) : Number(entity.rotation) || 0
    return this.rotateTextElement(result, angle, insertionPoint)
  }

  polyline(entity) {
    // Vertex flag 16 marks spline frame control points, which are not drawn.
    const vertices = (entity.vertices ?? []).filter((vertex) => !(Number(vertex.flag) & 16))
    if (vertices.length < 2) return null
    const closed = Boolean(Number(entity.flag) & 1)
    return this.vertices(interpolatePolyline({ vertices }, closed), closed)
  }

  solid(entity) {
    const { corner1, corner2, corner3 } = entity
    const corner4 = entity.corner4 ?? corner3
    if (!corner1 || !corner2 || !corner3) return null
    // SOLID corners are ordered in a Z pattern; the outline visits 1-2-4-3.
    const points = [corner1, corner2, corner4, corner3]
    return { bbox: boxFromPoints(points), element: `<path class="${CAD_FILL_CLASS}" d="${pointsToPathData(points, true)}" />` }
  }

  hatchEdgePoints(edge) {
    switch (edge?.type) {
      case 1:
        return edge.start && edge.end ? [edge.start, edge.end] : []
      case 2:
        return edge.center && isFiniteNumber(edge.radius)
          ? sampleArc(edge.center, edge.radius, edge.startAngle, edge.endAngle, edge.isCCW !== false)
          : []
      case 3:
        return edge.center && edge.end
          ? sampleEllipse(edge.center, edge.end, edge.lengthOfMinorAxis, edge.startAngle, edge.endAngle, edge.isCCW !== false)
          : []
      case 4: {
        const controlPoints = edge.controlPoints ?? []
        if (controlPoints.length < 2) return []
        try {
          const weights = controlPoints.some((point) => point.weight != null)
            ? controlPoints.map((point) => point.weight ?? 1)
            : undefined
          return this.interpolateBSpline(controlPoints, edge.degree, edge.knots, 10, weights)
        } catch {
          return controlPoints
        }
      }
      default:
        return []
    }
  }

  hatch(entity) {
    let d = ''
    const allPoints = []
    for (const path of entity.boundaryPaths ?? []) {
      const points = Array.isArray(path.vertices)
        ? interpolatePolyline({ vertices: path.vertices }, true)
        : (path.edges ?? []).flatMap((edge) => this.hatchEdgePoints(edge))
      if (points.length < 3) continue
      d += pointsToPathData(points, true)
      allPoints.push(...points)
    }
    if (!d) return null
    const solid = Number(entity.solidFill) === 1 || upper(entity.patternName) === 'SOLID'
    const opacity = solid ? '' : ` fill-opacity="${PATTERN_HATCH_OPACITY}"`
    return {
      bbox: boxFromPoints(allPoints),
      element: `<path class="${CAD_FILL_CLASS}" d="${d}" fill-rule="evenodd" stroke="none"${opacity} />`,
    }
  }

  insert(entity) {
    const block = this.ensureBlock(entity.name)
    if (!block) return null
    const basePoint = this.blockRecords.get(entity.name)?.basePoint ?? { x: 0, y: 0 }
    const insertionPoint = entity.insertionPoint ?? { x: 0, y: 0 }
    const xScale = isFiniteNumber(entity.xScale) && entity.xScale !== 0 ? entity.xScale : 1
    const yScale = isFiniteNumber(entity.yScale) && entity.yScale !== 0 ? entity.yScale : 1
    const rotation = Number(entity.rotation) || 0
    const cos = Math.cos(rotation)
    const sin = Math.sin(rotation)
    const columns = Math.max(1, Number(entity.columnCount) || 1)
    const rows = Math.max(1, Number(entity.rowCount) || 1)
    const bbox = new Box2D()
    const uses = []
    const href = escapeXml(entity.name)
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const localX = column * (Number(entity.columnSpacing) || 0)
        const localY = row * (Number(entity.rowSpacing) || 0)
        const originX = insertionPoint.x + localX * cos - localY * sin
        const originY = insertionPoint.y + localX * sin + localY * cos
        for (const corner of block.bbox.getCorners()) {
          const x = (corner.x - basePoint.x) * xScale
          const y = (corner.y - basePoint.y) * yScale
          bbox.expandByPoint({ x: originX + x * cos - y * sin, y: originY + x * sin + y * cos })
        }
        const transform = `translate(${originX},${originY}) rotate(${(rotation * 180) / Math.PI}) scale(${xScale},${yScale}) translate(${-basePoint.x},${-basePoint.y})`
        uses.push(`<use href="#${href}" transform="${transform}" />`)
      }
    }
    return { bbox, element: uses.join('') }
  }

  dimension(entity) {
    const block = this.ensureBlock(entity.name)
    if (!block) return null
    return { bbox: block.bbox.clone(), element: `<use href="#${escapeXml(entity.name)}" />` }
  }

  entityToBoundsAndElement(entity) {
    let result = null
    switch (entity.type) {
      case 'POLYLINE2D':
      case 'POLYLINE3D':
        result = this.polyline(entity)
        break
      case 'SOLID':
      case 'TRACE':
        result = this.solid(entity)
        break
      case 'HATCH':
        result = this.hatch(entity)
        break
      default:
        return super.entityToBoundsAndElement(entity)
    }
    return result ? this.addFlipXIfApplicable(entity, result) : null
  }

  /** Returns rendered entities with their bounds; layout blocks use this to derive view labels. */
  renderEntities(block) {
    const isLayoutBlock = upper(block.name) === MODEL_SPACE || upper(block.name).startsWith(PAPER_SPACE_PREFIX)
    const rendered = []
    for (const entity of block.entities ?? []) {
      if (this.isEntityHidden(entity)) continue
      let result = null
      try {
        result = this.entityToBoundsAndElement(entity)
      } catch {
        result = null
      }
      if (!result) continue
      const color = this.getEntityColor(this.layers, entity)
      const filled = FILLED_ENTITY_TYPES.has(entity.type)
      const layer = this.layerName(entity)
      // Layer-0 entities inside blocks follow the insert's layer for visibility and,
      // when ByLayer, take the colour of the insert like ByBlock.
      const followsInsertLayer = !isLayoutBlock && layer === '0'
      const inheritsColor = color.isByBlock || (followsInsertLayer && entity.colorIndex === 256)
      const layers = new Set(followsInsertLayer ? [] : [layer])
      if (entity.type === 'INSERT' || entity.type === 'DIMENSION') {
        for (const name of this.blockLayers.get(entity.name) ?? []) layers.add(name)
      }
      const id = escapeXml(entity.handle)
      const layerAttribute = followsInsertLayer ? '' : ` data-layer="${escapeXml(layer)}"`
      const element = inheritsColor
        ? `<g id="${id}"${layerAttribute}${filled ? '' : ' fill="none"'}>${result.element}</g>`
        : `<g id="${id}"${layerAttribute} stroke="${color.cssColor}" fill="${filled ? color.cssColor : 'none'}">${result.element}</g>`
      const initiallyVisible = followsInsertLayer || this.isLayerInitiallyVisible(layer)
      rendered.push({ entity, bbox: result.bbox, element, layers, initiallyVisible })
    }
    return rendered
  }

  block(block) {
    if (!block) return null
    const rendered = this.renderEntities(block)
    const bbox = new Box2D()
    const visibleBbox = new Box2D()
    const layers = new Set()
    for (const item of rendered) {
      for (const name of item.layers) layers.add(name)
      if (!item.bbox.valid) continue
      bbox.expandByPoint(item.bbox.min)
      bbox.expandByPoint(item.bbox.max)
      if (item.initiallyVisible) {
        visibleBbox.expandByPoint(item.bbox.min)
        visibleBbox.expandByPoint(item.bbox.max)
      }
    }
    if (!bbox.valid) return null
    // Initially hidden nested layers must not stretch the view extents.
    return {
      bbox: visibleBbox.valid ? visibleBbox : bbox,
      layers,
      element: `<g id="${escapeXml(block.name)}">${rendered.map((item) => item.element).join('\n')}</g>`,
    }
  }
}

function intersectBoxes(a, b) {
  if (!b) return a
  const box = new Box2D()
  const minX = Math.max(a.min.x, b.min.x)
  const minY = Math.max(a.min.y, b.min.y)
  const maxX = Math.min(a.max.x, b.max.x)
  const maxY = Math.min(a.max.y, b.max.y)
  if (!(minX < maxX && minY < maxY)) return box
  return box.expandByPoint({ x: minX, y: minY }).expandByPoint({ x: maxX, y: maxY })
}

function boxesOverlap(a, b) {
  return a.valid && b.valid && a.min.x < b.max.x && a.max.x > b.min.x && a.min.y < b.max.y && a.max.y > b.min.y
}

/** Model-space rectangle shown by a paper-space viewport, or null for 3D/perspective views. */
function getViewportModelWindow(viewport) {
  const direction = viewport.viewDirection
  if (direction && (Math.abs(direction.x) > 1e-9 || Math.abs(direction.y) > 1e-9 || direction.z <= 0)) return null
  const viewHeight = Number(viewport.viewHeight)
  const paperWidth = Number(viewport.width)
  const paperHeight = Number(viewport.height)
  if (!(viewHeight > 0 && paperWidth > 0 && paperHeight > 0)) return null
  const viewWidth = (viewHeight * paperWidth) / paperHeight
  const center = {
    x: Number(viewport.displayCenter?.x ?? 0) + Number(viewport.targetPoint?.x ?? 0),
    y: Number(viewport.displayCenter?.y ?? 0) + Number(viewport.targetPoint?.y ?? 0),
  }
  const window = new Box2D()
    .expandByPoint({ x: center.x - viewWidth / 2, y: center.y - viewHeight / 2 })
    .expandByPoint({ x: center.x + viewWidth / 2, y: center.y + viewHeight / 2 })
  const twist = Number(viewport.viewTwistAngle) || 0
  return twist ? window.rotate(-twist, center) : window
}

function prettifyLayerName(name) {
  return String(name)
    .replace(/^_+/, '')
    .replace(/\s*\((?:2D|3D)\)\s*$/i, '')
    .trim()
}

function deriveViewLabel(renderedModelEntities, window) {
  const counts = new Map()
  for (const item of renderedModelEntities) {
    if (!item.initiallyVisible || !item.bbox.valid || (window && !boxesOverlap(item.bbox, window))) continue
    const layer = String(item.entity.layer ?? '')
    if (!layer || layer === '0') continue
    counts.set(layer, (counts.get(layer) ?? 0) + 1)
  }
  const names = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([layer]) => prettifyLayerName(layer))
    .filter(Boolean)
  return names.length > 0 ? names.join(' + ') : null
}

function collectViewLayers(converter, rendered) {
  const names = new Set()
  for (const item of rendered) {
    for (const name of item.layers) names.add(name)
  }
  return [...names]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => converter.describeLayer(name))
}

function renderModelView(db, modelSpace, excludedLayers, initiallyHiddenLayers, window) {
  const converter = new LayerAwareSvgConverter(db, excludedLayers, initiallyHiddenLayers)
  const rendered = converter
    .renderEntities(modelSpace)
    .filter((item) => !window || !item.bbox.valid || boxesOverlap(item.bbox, window))
  const contentBox = new Box2D()
  for (const item of rendered) {
    if (!item.initiallyVisible || !item.bbox.valid) continue
    contentBox.expandByPoint(item.bbox.min)
    contentBox.expandByPoint(item.bbox.max)
  }
  if (!contentBox.valid) return null
  const viewBox = intersectBoxes(contentBox, window)
  if (!viewBox.valid) return null
  const width = viewBox.max.x - viewBox.min.x
  const height = viewBox.max.y - viewBox.min.y
  const svgContent = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" preserveAspectRatio="xMinYMin meet" viewBox="${viewBox.min.x} ${-viewBox.max.y} ${width} ${height}" width="100%" height="100%">
  ${CAD_FILL_STYLE}
  <defs>${converter.defs.join('')}</defs>
  <g stroke="#000000" stroke-width="0.1%" fill="none" transform="matrix(1,0,0,-1,0,0)">
    <g id="${escapeXml(modelSpace.name)}">${rendered.map((item) => item.element).join('\n')}</g>
  </g>
</svg>`
  return {
    svgContent,
    width,
    height,
    label: deriveViewLabel(rendered, window),
    layers: collectViewLayers(converter, rendered),
  }
}

/**
 * Reads per-viewport frozen layers straight from the LibreDWG object graph;
 * libredwg-web's JSON converter does not expose them yet.
 */
function readViewportFrozenLayers(libredwg, dwgData, db) {
  const result = new Map()
  const layerNamesByHandle = new Map((db?.tables?.LAYER?.entries ?? []).map((layer) => [upper(layer.handle), layer.name]))
  const objectCount = libredwg.dwg_get_num_objects(dwgData)
  for (let index = 0; index < objectCount; index += 1) {
    try {
      const object = libredwg.dwg_get_object(dwgData, index)
      if (!object || libredwg.dwg_object_get_fixedtype(object) !== DWG_TYPE_VIEWPORT) continue
      const entity = libredwg.dwg_object_to_entity_tio(object)
      const handle = libredwg.dwg_object_get_handle_object(object).value.toString(16).toUpperCase()
      const count = Number(libredwg.dwg_dynapi_entity_value(entity, 'num_frozen_layers').data) || 0
      const pointer = libredwg.dwg_dynapi_entity_value(entity, 'frozen_layers').data
      if (!count || !pointer) continue
      const names = libredwg
        .dwg_ptr_to_object_ref_ptr_array(pointer, count)
        .map((ref) => layerNamesByHandle.get(libredwg.dwg_ref_get_absref(ref).toString(16).toUpperCase()))
        .filter(Boolean)
      result.set(handle, names)
    } catch {
      // A damaged viewport record only loses its frozen-layer list.
    }
  }
  return result
}

function collectLayoutViewports(db) {
  const layoutNames = new Map((db?.objects?.LAYOUT ?? []).map((layout) => [upper(layout.paperSpaceTableId), layout.layoutName]))
  const viewports = []
  for (const block of db?.tables?.BLOCK_RECORD?.entries ?? []) {
    if (!upper(block.name).startsWith(PAPER_SPACE_PREFIX)) continue
    const blockViewports = (block.entities ?? []).filter((entity) => entity.type === 'VIEWPORT')
    // The first viewport of a layout is the sheet itself, not a view into model space.
    const sheetViewport = blockViewports.find((viewport) => viewport.viewportId === 1) ?? blockViewports[0]
    for (const viewport of blockViewports) {
      if (viewport === sheetViewport || viewport.isVisible === false) continue
      if (Number(viewport.statusBitFlags) & VIEWPORT_OFF_FLAG) continue
      viewports.push({ viewport, layoutName: layoutNames.get(upper(block.handle)) ?? block.name })
    }
  }
  return viewports
}

function sortInPaperReadingOrder(viewports) {
  const lefts = viewports.map(({ viewport }) => viewport.viewportCenter.x - viewport.width / 2)
  const span = Math.max(...lefts) - Math.min(...lefts)
  const tolerance = Math.max(span * 0.05, 1e-6)
  return [...viewports].sort((a, b) => {
    if (a.layoutName !== b.layoutName) return String(a.layoutName).localeCompare(String(b.layoutName))
    const leftA = a.viewport.viewportCenter.x - a.viewport.width / 2
    const leftB = b.viewport.viewportCenter.x - b.viewport.width / 2
    if (Math.abs(leftA - leftB) > tolerance) return leftA - leftB
    const topA = a.viewport.viewportCenter.y + a.viewport.height / 2
    const topB = b.viewport.viewportCenter.y + b.viewport.height / 2
    return topB - topA
  })
}

/**
 * Builds import views from a LibreDWG JSON database. Returns one view per
 * model-space viewport on the layouts, or a single model-space view when the
 * drawing has no usable layout viewports.
 */
function buildDwgViews(db, { viewportFrozenLayers = new Map() } = {}) {
  const modelSpace = (db?.tables?.BLOCK_RECORD?.entries ?? []).find((block) => upper(block.name) === MODEL_SPACE)
  if (!modelSpace) return []
  const excluded = getExcludedLayers()
  const initiallyHidden = getInitiallyHiddenLayers(db)
  const layoutViewports = sortInPaperReadingOrder(collectLayoutViewports(db))
  const multipleLayouts = new Set(layoutViewports.map((item) => item.layoutName)).size > 1

  const views = []
  for (const { viewport, layoutName } of layoutViewports) {
    const window = getViewportModelWindow(viewport)
    if (!window) continue
    const excludedLayers = new Set(excluded)
    for (const name of viewportFrozenLayers.get(upper(viewport.handle)) ?? []) excludedLayers.add(upper(name))
    const view = renderModelView(db, modelSpace, excludedLayers, initiallyHidden, window)
    if (!view) continue
    const baseLabel = view.label ?? `Viewport ${views.length + 1}`
    views.push({
      ...view,
      id: `viewport-${viewport.handle}`,
      label: multipleLayouts ? `${layoutName}: ${baseLabel}` : baseLabel,
    })
  }

  if (views.length === 0) {
    const view = renderModelView(db, modelSpace, excluded, initiallyHidden, null)
    if (view) views.push({ ...view, id: 'model', label: null })
  }

  const seen = new Map()
  for (const view of views) {
    if (!view.label) continue
    const count = (seen.get(view.label) ?? 0) + 1
    seen.set(view.label, count)
    if (count > 1) view.label = `${view.label} (${count})`
  }
  return views
}

module.exports = {
  CAD_FILL_STYLE,
  buildDwgViews,
  readViewportFrozenLayers,
  LayerAwareSvgConverter,
}

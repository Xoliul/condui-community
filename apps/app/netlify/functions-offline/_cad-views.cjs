'use strict'

// Reads DWG and DXF files with @node-projects/acad-ts (MIT) and renders one
// clean SVG per paper-space viewport. Architectural drawings commonly stack
// several floors on top of each other in model space and separate them only
// through per-viewport frozen layers, so rendering model space as a whole
// produces an unreadable overlay. Every view stays in model-space coordinates
// (outer matrix(1,0,0,-1,0,0)), which keeps CAD unit scaling and the CAD
// reference pipeline unchanged.
//
// Entity groups carry data-layer so the client can toggle layers without a
// server round-trip. Layers that are off, frozen or not plotted are still
// rendered but reported as initially hidden; Defpoints and layers frozen in the
// viewport (usually other floors) are never rendered. Block contents on layer
// "0" carry no data-layer: they follow the layer of their insert.
//
// acad-ts is ESM-only, so it is loaded with a dynamic import and passed to the
// renderer; entity types are matched with instanceof against its classes so a
// bundler renaming classes cannot change the output.
//
// Keep this file identical in netlify/functions and netlify/functions-offline.

const { DOMParser, XMLSerializer } = require('@xmldom/xmldom')

const MODEL_SPACE = '*MODEL_SPACE'
const VIEWPORT_OFF_FLAG = 0x20000
const LAYER_FROZEN_FLAG = 1
const VERTEX_SPLINE_FRAME_FLAG = 16
const ATTRIBUTE_HIDDEN_FLAG = 1
const NOTIFICATION_ERROR = 3
const PATTERN_HATCH_OPACITY = 0.2
const ARC_SEGMENT_RADIANS = Math.PI / 36
// Solid fills (wall poché, SOLID entities, hatches) make plans hard to trace over,
// so they are tagged and hidden by default. Removing CAD_FILL_STYLE shows them again.
const CAD_FILL_CLASS = 'cad-fill'
const CAD_FILL_STYLE = `<style>.${CAD_FILL_CLASS}{fill:none!important}</style>`
const FILLED_KINDS = new Set(['Text', 'Attribute', 'MText', 'Solid', 'Hatch', 'Insert', 'Dimension'])

// Subclasses come before their base classes (an attribute is also a text entity).
const ENTITY_KINDS = [
  ['AttributeDefinition', 'AttributeDefinition'],
  ['AttributeEntity', 'Attribute'],
  ['TextEntity', 'Text'],
  ['MText', 'MText'],
  ['Dimension', 'Dimension'],
  ['Insert', 'Insert'],
  ['Line', 'Line'],
  ['Arc', 'Arc'],
  ['Circle', 'Circle'],
  ['Ellipse', 'Ellipse'],
  ['Spline', 'Spline'],
  ['LwPolyline', 'LwPolyline'],
  ['Polyline2D', 'Polyline2D'],
  ['Polyline3D', 'Polyline3D'],
  ['Solid', 'Solid'],
  ['Face3D', 'Face3D'],
  ['Leader', 'Leader'],
  ['Hatch', 'Hatch'],
  ['Viewport', 'Viewport'],
  ['Point', 'Ignored'],
  ['Ray', 'Ignored'],
  ['XLine', 'Ignored'],
]

const upper = (value) => String(value ?? '').toUpperCase()
const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const fmt = (value) => (Math.abs(value) < 1e-9 ? '0' : String(Math.round(value * 1e6) / 1e6))
const hex = (handle) => {
  try {
    return BigInt(handle ?? 0).toString(16).toUpperCase()
  } catch {
    return String(handle ?? '')
  }
}

function escapeXml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

let acadTsPromise = null

/** Loads the ESM-only acad-ts package once per function instance. */
function loadAcadTs() {
  if (!acadTsPromise) acadTsPromise = import('@node-projects/acad-ts')
  return acadTsPromise
}

function readDxfDocument(cad, bytes, notify) {
  const reader = new cad.DxfReader(bytes, notify)
  // acad-ts 3.6.0 masks signed shorts to unsigned. In a layer's colour code,
  // -7 means white and switched off; 65529 loses both meanings. Its private
  // stream factory is the common hook for text, binary and legacy binary DXF.
  // Keep this correction on this reader's streams, never on a shared prototype.
  const createReader = reader._createReader
  reader._createReader = function (...args) {
    const stream = createReader.apply(this, args)
    Object.defineProperty(stream, 'valueAsShort', {
      get() { return (Number(this.value) << 16) >> 16 },
    })
    return stream
  }
  try {
    return reader.read()
  } finally {
    reader.dispose()
  }
}

// ---------- 2D boxes and affine transforms ([a,b,c,d,e,f]: x' = a x + c y + e, y' = b x + d y + f)

class Box {
  constructor() {
    this.minX = Infinity
    this.minY = Infinity
    this.maxX = -Infinity
    this.maxY = -Infinity
  }

  get valid() {
    return this.minX <= this.maxX && this.minY <= this.maxY
  }

  add(point) {
    if (!point || !finite(point.x) || !finite(point.y)) return this
    this.minX = Math.min(this.minX, point.x)
    this.minY = Math.min(this.minY, point.y)
    this.maxX = Math.max(this.maxX, point.x)
    this.maxY = Math.max(this.maxY, point.y)
    return this
  }

  addBox(box) {
    if (box?.valid) this.add({ x: box.minX, y: box.minY }).add({ x: box.maxX, y: box.maxY })
    return this
  }

  corners() {
    return [
      { x: this.minX, y: this.minY },
      { x: this.maxX, y: this.minY },
      { x: this.maxX, y: this.maxY },
      { x: this.minX, y: this.maxY },
    ]
  }

  overlaps(other) {
    return (
      this.valid &&
      other.valid &&
      this.minX < other.maxX &&
      this.maxX > other.minX &&
      this.minY < other.maxY &&
      this.maxY > other.minY
    )
  }

  intersect(other) {
    if (!other) return this
    const box = new Box()
    const minX = Math.max(this.minX, other.minX)
    const minY = Math.max(this.minY, other.minY)
    const maxX = Math.min(this.maxX, other.maxX)
    const maxY = Math.min(this.maxY, other.maxY)
    if (minX < maxX && minY < maxY) box.add({ x: minX, y: minY }).add({ x: maxX, y: maxY })
    return box
  }
}

const IDENTITY = [1, 0, 0, 1, 0, 0]
const multiply = (m, n) => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
]
const translate = (x, y) => [1, 0, 0, 1, x, y]
const rotate = (angle) => [Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 0, 0]
const scale = (x, y) => [x, 0, 0, y, 0, 0]
const apply = (m, p) => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] })
const matrixAttr = (m) => `matrix(${m.map(fmt).join(',')})`
const transformBox = (m, box) => {
  const out = new Box()
  if (box.valid) for (const corner of box.corners()) out.add(apply(m, corner))
  return out
}

/** Object coordinate system (arbitrary axis algorithm), projected onto the WCS XY plane. */
function ocsMatrix(normal) {
  const n = normal && finite(normal.z) ? normal : { x: 0, y: 0, z: 1 }
  const length = Math.hypot(n.x, n.y, n.z) || 1
  const N = { x: n.x / length, y: n.y / length, z: n.z / length }
  if (Math.abs(N.x) < 1e-12 && Math.abs(N.y) < 1e-12 && N.z > 0) return IDENTITY
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x })
  let ax = Math.abs(N.x) < 1 / 64 && Math.abs(N.y) < 1 / 64 ? cross({ x: 0, y: 1, z: 0 }, N) : cross({ x: 0, y: 0, z: 1 }, N)
  const axLength = Math.hypot(ax.x, ax.y, ax.z) || 1
  ax = { x: ax.x / axLength, y: ax.y / axLength, z: ax.z / axLength }
  const ay = cross(N, ax)
  return [ax.x, ax.y, ay.x, ay.y, 0, 0]
}

// ---------- geometry sampling

function sampleArc(center, radius, start, end) {
  let sweep = end - start
  while (sweep <= 0) sweep += Math.PI * 2
  const steps = Math.max(2, Math.ceil(sweep / ARC_SEGMENT_RADIANS))
  const points = []
  for (let i = 0; i <= steps; i += 1) {
    const angle = start + (sweep * i) / steps
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) })
  }
  return points
}

function bulgeSegment(p1, p2, bulge) {
  if (!bulge || Math.abs(bulge) < 1e-9) return [p2]
  const theta = 4 * Math.atan(bulge)
  const chord = Math.hypot(p2.x - p1.x, p2.y - p1.y)
  if (chord < 1e-12) return [p2]
  const radius = chord / (2 * Math.sin(Math.abs(theta) / 2))
  const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
  const centerDistance = radius * Math.cos(Math.abs(theta) / 2)
  const direction = { x: (p2.x - p1.x) / chord, y: (p2.y - p1.y) / chord }
  const side = bulge > 0 ? 1 : -1
  const center = { x: mid.x - direction.y * centerDistance * side, y: mid.y + direction.x * centerDistance * side }
  const startAngle = Math.atan2(p1.y - center.y, p1.x - center.x)
  const steps = Math.max(2, Math.ceil(Math.abs(theta) / ARC_SEGMENT_RADIANS))
  const points = []
  for (let i = 1; i <= steps; i += 1) {
    const angle = startAngle + (theta * i) / steps
    points.push({ x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) })
  }
  return points
}

function bulgePolyline(vertices, closed) {
  if (vertices.length === 0) return []
  const points = [vertices[0].point]
  const count = closed ? vertices.length : vertices.length - 1
  for (let i = 0; i < count; i += 1) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    points.push(...bulgeSegment(a.point, b.point, a.bulge))
  }
  return points
}

const pathData = (points, closed) =>
  points.map((p, i) => `${i === 0 ? 'M' : 'L'}${fmt(p.x)},${fmt(p.y)}`).join('') + (closed ? 'Z' : '')
const xy = (p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 })

function rgbCss(rgb) {
  if (!rgb || rgb.length < 3) return '#000000'
  const channels = Array.from(rgb).slice(0, 3)
  return `#${channels.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`
}

function colorCss(color) {
  if (!color) return '#000000'
  try {
    return rgbCss(color.isTrueColor ? color.getTrueColorRgb() : color.getRgb())
  } catch {
    return '#000000'
  }
}

function cleanTextCodes(value) {
  return String(value ?? '')
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%%/g, '%')
}

/**
 * MText inline formatting: keeps the text, applies the first height override
 * (\H2.5; absolute or \H0.5x; relative), and drops font, colour and layout codes.
 */
function parseMText(raw, baseHeight) {
  let height = baseHeight
  let heightSet = false
  let out = ''
  const s = String(raw ?? '')
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    if (ch === '{' || ch === '}') continue
    if (ch !== '\\') {
      out += ch
      continue
    }
    const code = s[i + 1]
    if (code === undefined) break
    if (code === 'P') {
      out += '\n'
      i += 1
    } else if (code === '~') {
      out += ' '
      i += 1
    } else if ('\\{}'.includes(code)) {
      out += code
      i += 1
    } else if ('LlOoKkNn'.includes(code)) {
      i += 1
    } else if (code === 'S') {
      // Stacked text: 1/2, 1#2 and tolerance 1^2 all read as "1/2".
      const end = s.indexOf(';', i)
      const body = end < 0 ? s.slice(i + 2) : s.slice(i + 2, end)
      out += body.replace(/[\^#]/, '/')
      i = end < 0 ? s.length : end
    } else if ('HhFfCcWwQqTtAap'.includes(code)) {
      const end = s.indexOf(';', i)
      const arg = end < 0 ? '' : s.slice(i + 2, end)
      if ((code === 'H' || code === 'h') && !heightSet) {
        const value = parseFloat(arg)
        if (value > 0) {
          height = /x$/i.test(arg) ? baseHeight * value : value
          heightSet = true
        }
      }
      i = end < 0 ? s.length : end
    } else {
      i += 1
    }
  }
  return { text: out, height }
}

// ---------- renderer

class CadSvgRenderer {
  constructor(cad, doc, excludedLayers, initiallyHiddenLayers) {
    this.cad = cad
    this.doc = doc
    this.excludedLayers = excludedLayers
    this.initiallyHiddenLayers = initiallyHiddenLayers
    this.blockDefs = new Map()
    this.blocksInProgress = new Set()
    this.defs = []
    this.unsupported = new Map()
    this.layerRecords = new Map([...(doc.layers ?? [])].map((layer) => [upper(layer.name), layer]))
  }

  kind(object) {
    for (const [className, kind] of ENTITY_KINDS) {
      const type = this.cad[className]
      if (typeof type === 'function' && object instanceof type) return kind
    }
    return null
  }

  /** Layer table spelling of an entity layer; CAD layer names are case-insensitive. */
  layerName(entity) {
    const raw = String(entity?.layer?.name ?? '') || '0'
    return String(this.layerRecords.get(upper(raw))?.name ?? raw)
  }

  isLayerInitiallyVisible(name) {
    return !this.initiallyHiddenLayers.has(upper(name))
  }

  /** Legend entry for a layer: its colour and whether it starts visible. */
  describeLayer(name) {
    const layer = this.layerRecords.get(upper(name))
    return { name, color: colorCss(layer?.color), visible: this.isLayerInitiallyVisible(name) }
  }

  note(entity) {
    let name = 'unknown'
    try {
      name = String(entity?.objectName || entity?.constructor?.name || name)
    } catch {
      // Keep the generic name.
    }
    this.unsupported.set(name, (this.unsupported.get(name) ?? 0) + 1)
  }

  /** Builds block definitions lazily so only blocks reachable from the view are emitted. */
  ensureBlock(record) {
    if (!record) return null
    const name = record.name
    if (this.blockDefs.has(name)) return this.blockDefs.get(name)
    if (this.blocksInProgress.has(name)) return null
    this.blocksInProgress.add(name)
    const rendered = this.renderEntities(record.entities ?? [], false)
    this.blocksInProgress.delete(name)
    const bbox = new Box()
    const visible = new Box()
    const layers = new Set()
    for (const item of rendered) {
      for (const layer of item.layers) layers.add(layer)
      bbox.addBox(item.bbox)
      if (item.initiallyVisible) visible.addBox(item.bbox)
    }
    const id = `blk_${this.blockDefs.size + 1}`
    // Initially hidden nested layers must not stretch the view extents.
    const def = bbox.valid ? { id, bbox: visible.valid ? visible : bbox, layers } : null
    this.blockDefs.set(name, def)
    if (def) this.defs.push(`<g id="${id}">${rendered.map((item) => item.element).join('')}</g>`)
    return def
  }

  pathElement(points, closed, extra = '') {
    if (points.length < 2) return null
    const bbox = new Box()
    for (const p of points) bbox.add(p)
    return { bbox, element: `<path d="${pathData(points, closed)}"${extra} />` }
  }

  textElement(value, height, anchorPoint, rotation, ocs, anchor, baseline, widthFactor = 1) {
    const text = cleanTextCodes(value)
    if (!text.trim() || !finite(height) || height <= 0) return null
    const lines = text.split('\n')
    const wf = finite(widthFactor) && widthFactor > 0 ? widthFactor : 1
    // Text is drawn upright inside the outer Y flip.
    const m = multiply(ocs, multiply(translate(anchorPoint.x, anchorPoint.y), multiply(rotate(rotation || 0), scale(wf, -1))))
    const widest = Math.max(...lines.map((line) => line.length)) * height * 0.6
    const lineHeight = height * 1.5
    const totalHeight = lines.length * lineHeight
    const left = anchor === 'middle' ? -widest / 2 : anchor === 'end' ? -widest : 0
    const top = baseline === 'top' ? 0 : baseline === 'middle' ? -totalHeight / 2 : -totalHeight + height * 0.5
    const local = new Box().add({ x: left, y: top }).add({ x: left + widest, y: top + totalHeight })
    const firstDy =
      baseline === 'top'
        ? height
        : baseline === 'middle'
          ? height * 0.35 - ((lines.length - 1) * lineHeight) / 2
          : -(lines.length - 1) * lineHeight
    const tspans = lines
      .map((line, i) => `<tspan x="0" dy="${fmt(i === 0 ? firstDy : lineHeight)}">${escapeXml(line)}</tspan>`)
      .join('')
    return {
      bbox: transformBox(m, local),
      // CAD text is filled only; an inherited stroke makes glyphs look bloated.
      element: `<text transform="${matrixAttr(m)}" font-size="${fmt(height)}" text-anchor="${anchor}" stroke="none" font-family="Arial, Helvetica, sans-serif">${tspans}</text>`,
    }
  }

  text(entity) {
    const ocs = ocsMatrix(entity.normal)
    const h = Number(entity.horizontalAlignment) || 0
    const v = Number(entity.verticalAlignment) || 0
    const aligned = (h !== 0 || v !== 0) && entity.alignmentPoint
    const point = xy(aligned ? entity.alignmentPoint : entity.insertPoint)
    const anchor = h === 1 || h === 4 ? 'middle' : h === 2 ? 'end' : 'start'
    const baseline = v === 3 ? 'top' : v === 2 || h === 4 ? 'middle' : 'bottom'
    return this.textElement(
      entity.value,
      Number(entity.height),
      point,
      Number(entity.rotation) || 0,
      ocs,
      anchor,
      baseline,
      Number(entity.widthFactor),
    )
  }

  mtext(entity) {
    const attachment = Number(entity.attachmentPoint) || 1
    const column = (attachment - 1) % 3
    const row = Math.floor((attachment - 1) / 3)
    const anchor = column === 1 ? 'middle' : column === 2 ? 'end' : 'start'
    const baseline = row === 0 ? 'top' : row === 1 ? 'middle' : 'bottom'
    const { text, height } = parseMText(entity.value, Number(entity.height))
    let rotation = 0
    try {
      rotation = Number(entity.rotation) || 0
    } catch {
      rotation = 0
    }
    return this.textElement(text, height, xy(entity.insertPoint), rotation, IDENTITY, anchor, baseline)
  }

  insert(entity) {
    const block = this.ensureBlock(entity.block)
    const parts = []
    const bbox = new Box()
    const layers = new Set(block?.layers ?? [])
    if (block) {
      const base = xy(entity.block?.blockEntity?.basePoint)
      const ocs = ocsMatrix(entity.normal)
      const p = xy(entity.insertPoint)
      const sx = finite(entity.xScale) && entity.xScale !== 0 ? entity.xScale : 1
      const sy = finite(entity.yScale) && entity.yScale !== 0 ? entity.yScale : 1
      const rotation = Number(entity.rotation) || 0
      const columns = Math.max(1, Number(entity.columnCount) || 1)
      const rows = Math.max(1, Number(entity.rowCount) || 1)
      for (let r = 0; r < rows; r += 1) {
        for (let c = 0; c < columns; c += 1) {
          const offset = apply(rotate(rotation), {
            x: c * (Number(entity.columnSpacing) || 0),
            y: r * (Number(entity.rowSpacing) || 0),
          })
          const m = multiply(
            ocs,
            multiply(
              translate(p.x + offset.x, p.y + offset.y),
              multiply(rotate(rotation), multiply(scale(sx, sy), translate(-base.x, -base.y))),
            ),
          )
          bbox.addBox(transformBox(m, block.bbox))
          parts.push(`<use href="#${block.id}" transform="${matrixAttr(m)}" />`)
        }
      }
    }
    // Attributes have their own layers, independently of their INSERT. Reuse
    // normal entity rendering so excluded/frozen layers and layer toggles work.
    const attributes = this.renderEntities(entity.attributes ?? [], false)
    for (const attribute of attributes) {
      if (attribute.initiallyVisible) bbox.addBox(attribute.bbox)
      for (const layer of attribute.layers) layers.add(layer)
      parts.push(attribute.element)
    }
    if (!bbox.valid) for (const attribute of attributes) bbox.addBox(attribute.bbox)
    return parts.length ? { bbox, element: parts.join(''), blockLayers: layers } : null
  }

  hatch(entity) {
    const cad = this.cad
    const ocs = ocsMatrix(entity.normal)
    let d = ''
    const bbox = new Box()
    for (const path of entity.paths ?? []) {
      const points = []
      for (const edge of path.edges ?? []) {
        if (edge instanceof cad.HatchBoundaryPathPolyline) {
          const vertices = (edge.vertices ?? []).map((v, i) => ({ point: xy(v), bulge: edge.bulges?.[i] ?? 0 }))
          points.push(...bulgePolyline(vertices, edge.isClosed !== false))
        } else if (edge instanceof cad.HatchBoundaryPathLine) {
          points.push(xy(edge.start), xy(edge.end))
        } else if (edge instanceof cad.HatchBoundaryPathArc || edge instanceof cad.HatchBoundaryPathEllipse) {
          try {
            points.push(...edge.polygonalVertexes(36).map(xy))
          } catch {
            // A damaged edge only loses its curve.
          }
        } else if (edge instanceof cad.HatchBoundaryPathSpline) {
          points.push(...(edge.fitPoints?.length ? edge.fitPoints : (edge.controlPoints ?? [])).map(xy))
        }
      }
      if (points.length < 3) continue
      const world = points.map((p) => apply(ocs, p))
      for (const p of world) bbox.add(p)
      d += pathData(world, true)
    }
    if (!d) return null
    const opacity = entity.isSolid ? '' : ` fill-opacity="${PATTERN_HATCH_OPACITY}"`
    return { bbox, element: `<path class="${CAD_FILL_CLASS}" d="${d}" fill-rule="evenodd" stroke="none"${opacity} />` }
  }

  geometry(entity, kind) {
    switch (kind) {
      case 'Line':
        return this.pathElement([xy(entity.startPoint), xy(entity.endPoint)], false)
      case 'Arc': {
        const ocs = ocsMatrix(entity.normal)
        const points = sampleArc(xy(entity.center), Number(entity.radius), Number(entity.startAngle), Number(entity.endAngle))
        return this.pathElement(points.map((p) => apply(ocs, p)), false)
      }
      case 'Circle': {
        const center = apply(ocsMatrix(entity.normal), xy(entity.center))
        const r = Number(entity.radius)
        if (!(r > 0)) return null
        const bbox = new Box().add({ x: center.x - r, y: center.y - r }).add({ x: center.x + r, y: center.y + r })
        return { bbox, element: `<circle cx="${fmt(center.x)}" cy="${fmt(center.y)}" r="${fmt(r)}" />` }
      }
      case 'Ellipse':
        return this.pathElement(entity.polygonalVertexes(72).map(xy), entity.isFullEllipse)
      case 'Spline': {
        let points = []
        try {
          const result = entity.tryPolygonalVertexes(256)
          if (result?.success) points = result.points
        } catch {
          points = []
        }
        if (points.length < 2) points = entity.fitPoints?.length ? entity.fitPoints : (entity.controlPoints ?? [])
        return this.pathElement(points.map(xy), entity.isClosed)
      }
      case 'LwPolyline': {
        const ocs = ocsMatrix(entity.normal)
        const vertices = (entity.vertices ?? []).map((v) => ({ point: xy(v.location), bulge: Number(v.bulge) || 0 }))
        return this.pathElement(bulgePolyline(vertices, entity.isClosed).map((p) => apply(ocs, p)), entity.isClosed)
      }
      case 'Polyline2D':
      case 'Polyline3D': {
        const flat = kind === 'Polyline2D'
        const ocs = flat ? ocsMatrix(entity.normal) : IDENTITY
        // Vertex flag 16 marks spline frame control points, which are not drawn.
        const vertices = [...(entity.vertices ?? [])]
          .filter((v) => !(Number(v.flags) & VERTEX_SPLINE_FRAME_FLAG))
          .map((v) => ({ point: xy(v.location), bulge: flat ? Number(v.bulge) || 0 : 0 }))
        return this.pathElement(bulgePolyline(vertices, entity.isClosed).map((p) => apply(ocs, p)), entity.isClosed)
      }
      case 'Solid': {
        const ocs = ocsMatrix(entity.normal)
        const c1 = xy(entity.firstCorner)
        const c2 = xy(entity.secondCorner)
        const c3 = xy(entity.thirdCorner)
        const c4 = entity.fourthCorner ? xy(entity.fourthCorner) : c3
        // SOLID corners are ordered in a Z pattern; the outline visits 1-2-4-3.
        return this.pathElement([c1, c2, c4, c3].map((p) => apply(ocs, p)), true, ` class="${CAD_FILL_CLASS}"`)
      }
      case 'Face3D':
        return this.pathElement(
          [entity.firstCorner, entity.secondCorner, entity.thirdCorner, entity.fourthCorner].map(xy),
          true,
        )
      case 'Leader':
        return this.pathElement((entity.vertices ?? []).map(xy), false)
      case 'Text':
        return this.text(entity)
      case 'Attribute':
        // ATTMODE: 0 hides all attributes, 1 uses each attribute's flag,
        // 2 shows all attributes, including those flagged invisible.
        if (this.doc.header?.attributeVisibility === 0) return null
        if (this.doc.header?.attributeVisibility !== 2 && Number(entity.flags) & ATTRIBUTE_HIDDEN_FLAG) return null
        return this.text(entity)
      case 'MText':
        return this.mtext(entity)
      case 'Insert':
        return this.insert(entity)
      case 'Hatch':
        return this.hatch(entity)
      case 'Dimension': {
        const block = this.ensureBlock(entity.block)
        return block ? { bbox: block.bbox, element: `<use href="#${block.id}" />`, blockLayers: block.layers } : null
      }
      case 'AttributeDefinition':
      case 'Viewport':
      case 'Ignored':
        return null
      default:
        this.note(entity)
        return null
    }
  }

  /** Returns rendered entities with their bounds; model space uses this to derive view labels. */
  renderEntities(entities, isLayoutBlock) {
    const rendered = []
    for (const entity of entities) {
      if (entity.isInvisible) continue
      const layer = this.layerName(entity)
      if (this.excludedLayers.has(upper(layer))) continue
      const kind = this.kind(entity)
      let result = null
      try {
        result = this.geometry(entity, kind)
      } catch {
        this.note(entity)
        result = null
      }
      if (!result) continue
      const color = entity.color
      // Layer-0 entities inside blocks follow the insert's layer for visibility and,
      // when ByLayer, take the colour of the insert like ByBlock.
      const followsInsertLayer = !isLayoutBlock && layer === '0'
      const inheritsColor = color?.isByBlock || (followsInsertLayer && color?.isByLayer)
      const css = color?.isByLayer ? colorCss(this.layerRecords.get(upper(layer))?.color) : colorCss(color)
      const filled = FILLED_KINDS.has(kind)
      const layers = new Set(followsInsertLayer ? [] : [layer])
      for (const name of result.blockLayers ?? []) layers.add(name)
      const layerAttribute = followsInsertLayer ? '' : ` data-layer="${escapeXml(layer)}"`
      const id = `h${hex(entity.handle)}`
      const element = inheritsColor
        ? `<g id="${id}"${layerAttribute}${filled ? '' : ' fill="none"'}>${result.element}</g>`
        : `<g id="${id}"${layerAttribute} stroke="${css}" fill="${filled ? css : 'none'}">${result.element}</g>`
      rendered.push({
        layer,
        bbox: result.bbox,
        element,
        layers,
        initiallyVisible: followsInsertLayer || this.isLayerInitiallyVisible(layer),
      })
    }
    return rendered
  }
}

// ---------- views

/** Layers rendered for toggling but hidden initially: off, frozen, or not plotted. */
function getInitiallyHiddenLayers(doc) {
  const hidden = new Set()
  for (const layer of doc.layers ?? []) {
    if (!layer.isOn || Number(layer.layerFlags) & LAYER_FROZEN_FLAG || layer.plotFlag === false) hidden.add(upper(layer.name))
  }
  return hidden
}

/** Model-space rectangle shown by a paper-space viewport, or null for 3D/perspective views. */
function getViewportModelWindow(viewport) {
  const direction = viewport.viewDirection
  if (direction && (Math.abs(direction.x) > 1e-9 || Math.abs(direction.y) > 1e-9 || direction.z <= 0)) return null
  const viewHeight = Number(viewport.viewHeight)
  const width = Number(viewport.width)
  const height = Number(viewport.height)
  if (!(viewHeight > 0 && width > 0 && height > 0)) return null
  const viewWidth = (viewHeight * width) / height
  const center = {
    x: Number(viewport.viewCenter?.x ?? 0) + Number(viewport.viewTarget?.x ?? 0),
    y: Number(viewport.viewCenter?.y ?? 0) + Number(viewport.viewTarget?.y ?? 0),
  }
  const window = new Box()
    .add({ x: center.x - viewWidth / 2, y: center.y - viewHeight / 2 })
    .add({ x: center.x + viewWidth / 2, y: center.y + viewHeight / 2 })
  const twist = Number(viewport.twistAngle) || 0
  if (!twist) return window
  return transformBox(multiply(translate(center.x, center.y), multiply(rotate(-twist), translate(-center.x, -center.y))), window)
}

function prettifyLayerName(name) {
  return String(name)
    .replace(/^_+/, '')
    .replace(/\s*\((?:2D|3D)\)\s*$/i, '')
    .trim()
}

function deriveViewLabel(rendered, window) {
  const counts = new Map()
  for (const item of rendered) {
    if (!item.initiallyVisible || !item.bbox.valid || (window && !item.bbox.overlaps(window))) continue
    if (!item.layer || item.layer === '0') continue
    counts.set(item.layer, (counts.get(item.layer) ?? 0) + 1)
  }
  const names = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([layer]) => prettifyLayerName(layer))
    .filter(Boolean)
  return names.length > 0 ? names.join(' + ') : null
}

function renderModelView(cad, doc, excludedLayers, hiddenLayers, window) {
  const renderer = new CadSvgRenderer(cad, doc, excludedLayers, hiddenLayers)
  const rendered = renderer
    .renderEntities(doc.modelSpace?.entities ?? [], true)
    .filter((item) => !window || !item.bbox.valid || item.bbox.overlaps(window))
  const content = new Box()
  for (const item of rendered) if (item.initiallyVisible) content.addBox(item.bbox)
  const viewBox = content.valid ? content.intersect(window) : content
  if (!viewBox.valid) return { view: null, unsupported: renderer.unsupported }
  const width = viewBox.maxX - viewBox.minX
  const height = viewBox.maxY - viewBox.minY
  const svgContent = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" version="1.1" preserveAspectRatio="xMinYMin meet" viewBox="${fmt(viewBox.minX)} ${fmt(-viewBox.maxY)} ${fmt(width)} ${fmt(height)}" width="100%" height="100%">
  ${CAD_FILL_STYLE}
  <defs>${renderer.defs.join('')}</defs>
  <g stroke="#000000" stroke-width="0.1%" fill="none" transform="matrix(1,0,0,-1,0,0)">
    <g id="model_space">${rendered.map((item) => item.element).join('\n')}</g>
  </g>
</svg>`
  const layerNames = new Set()
  for (const item of rendered) for (const name of item.layers) layerNames.add(name)
  const layers = [...layerNames]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map((name) => renderer.describeLayer(name))
  return {
    view: { svgContent, width, height, label: deriveViewLabel(rendered, window), layers },
    unsupported: renderer.unsupported,
  }
}

function collectLayoutViewports(cad, doc) {
  const viewports = []
  for (const layout of doc.layouts ?? []) {
    const block = layout.associatedBlock
    if (!block || upper(block.name) === MODEL_SPACE) continue
    const all = [...(block.entities ?? [])].filter((entity) => entity instanceof cad.Viewport)
    // The first viewport of a layout is the sheet itself, not a view into model space.
    const sheet = all.find((viewport) => viewport.id === 1) ?? all[0]
    for (const viewport of all) {
      if (viewport === sheet || viewport.isInvisible) continue
      if (Number(viewport.status) & VIEWPORT_OFF_FLAG) continue
      viewports.push({ viewport, layoutName: layout.name })
    }
  }
  const left = ({ viewport }) => Number(viewport.center?.x ?? 0) - Number(viewport.width) / 2
  const top = ({ viewport }) => Number(viewport.center?.y ?? 0) + Number(viewport.height) / 2
  const lefts = viewports.map(left)
  const tolerance = Math.max((Math.max(...lefts) - Math.min(...lefts)) * 0.05, 1e-6)
  // Paper reading order: layouts by name, then columns left to right, top to bottom.
  return viewports.sort((a, b) => {
    if (a.layoutName !== b.layoutName) return String(a.layoutName).localeCompare(String(b.layoutName))
    if (Math.abs(left(a) - left(b)) > tolerance) return left(a) - left(b)
    return top(b) - top(a)
  })
}

/**
 * Builds import views from an acad-ts document: one view per model-space
 * viewport on the layouts, or a single model-space view when the drawing has
 * no usable layout viewports. `unsupported` counts skipped entities by type.
 */
function buildCadViews(cad, doc) {
  const unsupported = new Map()
  const merge = (counts) => {
    for (const [name, count] of counts) unsupported.set(name, (unsupported.get(name) ?? 0) + count)
  }
  if (!doc?.modelSpace) return { views: [], unsupported }
  const excluded = new Set(['DEFPOINTS'])
  const hidden = getInitiallyHiddenLayers(doc)
  const layoutViewports = collectLayoutViewports(cad, doc)
  const multipleLayouts = new Set(layoutViewports.map((item) => item.layoutName)).size > 1

  const views = []
  let countedModelSpace = false
  for (const { viewport, layoutName } of layoutViewports) {
    const window = getViewportModelWindow(viewport)
    if (!window) continue
    const excludedLayers = new Set(excluded)
    for (const layer of viewport.frozenLayers ?? []) excludedLayers.add(upper(layer?.name))
    const { view, unsupported: skipped } = renderModelView(cad, doc, excludedLayers, hidden, window)
    // Every viewport renders the same model space; count skipped entities once.
    if (!countedModelSpace) merge(skipped)
    countedModelSpace = true
    if (!view) continue
    const baseLabel = view.label ?? `Viewport ${views.length + 1}`
    views.push({
      ...view,
      id: `viewport-${hex(viewport.handle)}`,
      label: multipleLayouts ? `${layoutName}: ${baseLabel}` : baseLabel,
    })
  }

  if (views.length === 0) {
    const { view, unsupported: skipped } = renderModelView(cad, doc, excluded, hidden, null)
    merge(skipped)
    if (view) views.push({ ...view, id: 'model', label: null })
  }

  const seen = new Map()
  for (const view of views) {
    if (!view.label) continue
    const count = (seen.get(view.label) ?? 0) + 1
    seen.set(view.label, count)
    if (count > 1) view.label = `${view.label} (${count})`
  }
  return { views, unsupported }
}

const plainPoint = (point) =>
  point && finite(point.x) && finite(point.y) ? { x: point.x, y: point.y, z: finite(point.z) ? point.z : 0 } : undefined

/** Header values the CAD reference pipeline uses for units and extents. */
function readCadMetadata(doc) {
  const header = doc?.header ?? {}
  // MEASUREMENT is 0 (imperial) or 1 (metric); acad-ts 3.6 misreads it in some R2018 files.
  const measurement = header.measurementUnits === 0 || header.measurementUnits === 1 ? header.measurementUnits : undefined
  return {
    insunits: header.insUnits,
    measurement,
    extmin: plainPoint(header.modelSpaceExtMin),
    extmax: plainPoint(header.modelSpaceExtMax),
  }
}

/**
 * Prepares a view for use as an image: explicit size, hairline strokes, unique
 * ids, and dark ink instead of AutoCAD's white (colour 7 on a dark screen).
 */
function normalizeSvgForImageUse(svgContent) {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svgContent, 'image/svg+xml')
  const svg = doc.documentElement
  const viewBox = svg.getAttribute('viewBox')
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).map(Number).filter(Number.isFinite)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      svg.setAttribute('width', String(parts[2]))
      svg.setAttribute('height', String(parts[3]))
    }
  }

  const style = doc.createElement('style')
  style.textContent = `
    line, path, polyline, polygon, rect, circle, ellipse {
      vector-effect: non-scaling-stroke;
      stroke-width: 1px;
    }
  `
  svg.insertBefore(style, svg.firstChild)

  const idMap = new Map()
  let idCounter = 0
  const visit = (node) => {
    if (!node || node.nodeType !== 1) return
    const id = node.getAttribute('id')
    if (id) {
      const safeId = `cad_${++idCounter}`
      idMap.set(id, safeId)
      node.setAttribute('id', safeId)
    }
    for (let i = 0; i < node.childNodes.length; i += 1) {
      visit(node.childNodes[i])
    }
  }
  visit(svg)

  const updateReferences = (node) => {
    if (!node || node.nodeType !== 1) return
    for (const attrName of ['href', 'xlink:href']) {
      const value = node.getAttribute(attrName)
      if (value && value.startsWith('#')) {
        const mapped = idMap.get(value.slice(1))
        if (mapped) node.setAttribute(attrName, `#${mapped}`)
      }
    }
    for (let i = 0; i < node.childNodes.length; i += 1) {
      updateReferences(node.childNodes[i])
    }
  }
  updateReferences(svg)

  return new XMLSerializer()
    .serializeToString(svg)
    .replace(/rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)/gi, '#111827')
    .replace(/#fff\b/gi, '#111827')
    .replace(/#ffffff\b/gi, '#111827')
    .replace(/\bwhite\b/gi, '#111827')
}

/**
 * Reads a DWG or DXF buffer and renders its import views, normalized for image use.
 * Returns { views, cadMetadata, warnings }; throws when the file cannot be read.
 */
async function convertCadBuffer(buffer, kind) {
  const cad = await loadAcadTs()
  let readerErrors = 0
  const notify = (_sender, event) => {
    if (event?.notificationType === NOTIFICATION_ERROR) readerErrors += 1
  }
  // acad-ts 3.6.0's CadInsertTemplate applies the INSERT transform to ATTRIBs
  // read from both file formats. Their text geometry is already in drawing OCS:
  // applying it again scales heights twice and moves/rotates the text twice.
  // Suppress only that reader callback, leaving normal programmatic inserts
  // unchanged. Reading is synchronous: never await inside this try/finally.
  const applyAttributeTransform = cad.Insert.prototype.applyAttributeTransform
  let doc
  try {
    cad.Insert.prototype.applyAttributeTransform = function () {}
    doc =
      kind === 'dxf'
        ? readDxfDocument(cad, new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength), notify)
        : cad.DwgReader.readFromStream(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), notify)
  } finally {
    cad.Insert.prototype.applyAttributeTransform = applyAttributeTransform
  }
  const { views, unsupported } = buildCadViews(cad, doc)
  const warnings = []
  if (readerErrors > 0) {
    warnings.push(`${kind.toUpperCase()} reader recovered from ${readerErrors} damaged records; some objects may be missing.`)
  }
  if (unsupported.size > 0) {
    const skipped = [...unsupported.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} (${count})`)
      .join(', ')
    warnings.push(`Skipped unsupported CAD objects: ${skipped}.`)
  }
  return {
    views: views.map((view) => ({ ...view, svgContent: normalizeSvgForImageUse(view.svgContent) })),
    cadMetadata: readCadMetadata(doc),
    warnings,
  }
}

module.exports = {
  CAD_FILL_STYLE,
  buildCadViews,
  convertCadBuffer,
  loadAcadTs,
  normalizeSvgForImageUse,
  parseMText,
  readCadMetadata,
}

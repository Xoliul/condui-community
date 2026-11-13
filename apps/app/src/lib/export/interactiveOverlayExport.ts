import Konva from 'konva'

/** Marker used for canvas-only hit targets, hover, selection, and preview visuals. */
export const INTERACTIVE_OVERLAY_EXPORT_NAME = 'export-strip-interaction-overlay'

/** Remove transient interaction visuals from an isolated export scene. */
export function stripInteractiveOverlaysForExport(root: Konva.Container): void {
  root
    .find((node: Konva.Node) => node.hasName(INTERACTIVE_OVERLAY_EXPORT_NAME))
    .forEach((node) => node.destroy())
}

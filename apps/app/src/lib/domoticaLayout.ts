/**
 * Domotica layout constants — single source of truth for 1draad layout and wire derivation.
 * Used by lib/layout (deriveWires, layoutTree) and re-exported by canvasSymbols for components.
 */

export const DOMOTICA_BOX_WIDTH = 20
/** Compact center drop target around the 20-unit Domotica child symbol. */
export const DOMOTICA_CHILD_ON_DROP_ZONE_SIZE = 24
export const DOMOTICA_BASE_HEIGHT = 26
export const DOMOTICA_OUTPUT_SPACING = 20
export const DOMOTICA_BRANCH_LEAD = 25
export const DOMOTICA_BRANCH_CONTROL_LEAD = 15
/** Gap between the rightmost output symbol and its row label. */
export const DOMOTICA_CHILD_LABEL_GAP = 8
export const DOMOTICA_ENDPOINT_OUTPUT_START_Y = 0
export const DOMOTICA_CONTROL_OUTPUT_Y = 0
export const DOMOTICA_MIN_ENDPOINT_OUTPUTS = 1
export const DOMOTICA_MAX_ENDPOINT_OUTPUTS = 20

// Height of the top control band inside the domotica frame (in eendraad units).
// A horizontal divider is drawn at this offset from the top edge to separate
// control icons from the main device type area.
export const DOMOTICA_CONTROL_BAR_HEIGHT = 5

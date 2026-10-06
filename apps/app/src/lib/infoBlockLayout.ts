/**
 * Shared layout and data for the info block (installer, address, general).
 * Used by the Eendraad canvas InfoBlock and by PDF export.
 *
 * TWEAK GUIDE — change these to adjust appearance:
 *
 * Total frame size / column widths:
 *   INFO_BLOCK_BOX_WIDTHS.installer — width of left column (Installer)
 *   INFO_BLOCK_BOX_WIDTHS.address   — width of middle column (Installation address)
 *   INFO_BLOCK_BOX_WIDTHS.general   — width of right column (view title, date, voltage, EAN)
 *   INFO_BLOCK_BOX_WIDTHS.inspectionAgency / .logo — optional columns (see InfoBlockColumns)
 *   (Total width = installer + address + general + 2× INFO_BLOCK_GAP.)
 *   INFO_BLOCK_INSTALLER_TOP_HEIGHT — height of name+address block in installer column
 *   INFO_BLOCK_IMAGE_AREA_HEIGHT    — height of logo+signature area
 *   INFO_BLOCK_MADE_WITH_HEIGHT    — height of "Made with…" footer
 *   INFO_BLOCK_PADDING             — top/bottom padding; with the above, drives total height.
 *   INFO_BLOCK_GENERAL_ROW_HEIGHT  — row height in general column (does not change total height).
 *
 * Line thicknesses:
 *   INFO_BLOCK_STROKE_WIDTH_FRAME     — outer rectangle (main frame)
 *   INFO_BLOCK_STROKE_WIDTH_SEPARATOR — vertical column dividers and horizontal header underlines
 *
 * Font sizes (px):
 *   INFO_BLOCK_FONT_SIZE_HEADER  — column titles ("Installation address", "Installer", view title)
 *   INFO_BLOCK_FONT_SIZE_NAME    — installer name (body, bold)
 *   INFO_BLOCK_FONT_SIZE_BODY    — address, date, voltage, EAN, general content
 *   INFO_BLOCK_FONT_SIZE_MADE_WITH — "Made with Eendraa.be" footer
 * (Bold is applied in InfoBlock.tsx: headers and installer name use fontStyle="bold".)
 *
 * Margins and positioning:
 *   INFO_BLOCK_PADDING           — inset from outer frame to content; also separator line vertical margin
 *   INFO_BLOCK_GAP               — horizontal gap between the three columns
 *   INFO_BLOCK_HEADER_LINE_GAP   — vertical gap between header text and the thin line under it
 *   INFO_BLOCK_BODY_TOP_GAP      — vertical gap between header underline and first body line
 *   INFO_BLOCK_HEADER_LINE_INSET — horizontal inset of header underlines from column edges
 *   INFO_BLOCK_BODY_LINE_HEIGHT  — vertical step between body lines (e.g. installer name → address)
 *
 * Letter spacing: Konva Text does not support letterSpacing. Font family is set in InfoBlock.tsx
 * via useCanvasFontFamily() (same as rest of canvas).
 */

import type { Installation, ProjectPartyContact } from '@/types/schema'
import { getVoltageSummaryLabel } from '@/utils/voltageLabel'

/** Column widths (px). Change these to resize columns; total frame width is derived automatically. */
export const INFO_BLOCK_BOX_WIDTHS = {
  inspectionAgency: 150,
  /** Installer logo, shown left of the installer column when the effective profile includes one. */
  logo: 110,
  installer: 150,
  address: 120,
  general: 120,
} as const

export const INFO_BLOCK_PADDING = 8
export const INFO_BLOCK_GAP = 4

/** Line thicknesses */
export const INFO_BLOCK_STROKE_WIDTH_FRAME = 1
export const INFO_BLOCK_STROKE_WIDTH_SEPARATOR = 0.5

/** @deprecated Use INFO_BLOCK_STROKE_WIDTH_FRAME */
export const INFO_BLOCK_BORDER = INFO_BLOCK_STROKE_WIDTH_FRAME

/** Font sizes (px) */
export const INFO_BLOCK_FONT_SIZE_HEADER = 8
export const INFO_BLOCK_FONT_SIZE_NAME = 8
export const INFO_BLOCK_FONT_SIZE_BODY = 7
export const INFO_BLOCK_FONT_SIZE_MADE_WITH = 5.5

/** Vertical/horizontal spacing for header and body */
export const INFO_BLOCK_HEADER_LINE_GAP = 6
export const INFO_BLOCK_BODY_TOP_GAP = 6
export const INFO_BLOCK_HEADER_LINE_INSET = 6
export const INFO_BLOCK_BODY_LINE_HEIGHT = 12

/** Total width of the three boxes side by side */
export const INFO_BLOCK_TOTAL_WIDTH =
  INFO_BLOCK_BOX_WIDTHS.installer +
  INFO_BLOCK_BOX_WIDTHS.address +
  INFO_BLOCK_BOX_WIDTHS.general +
  INFO_BLOCK_GAP * 2

/** Optional columns that widen the info block. Layout, canvas and export must agree. */
export type InfoBlockColumns = {
  inspectionAgency?: boolean
  logo?: boolean
}

export function getInfoBlockTotalWidth(columns: InfoBlockColumns = {}): number {
  return (
    INFO_BLOCK_TOTAL_WIDTH +
    (columns.inspectionAgency ? INFO_BLOCK_BOX_WIDTHS.inspectionAgency + INFO_BLOCK_GAP : 0) +
    (columns.logo ? INFO_BLOCK_BOX_WIDTHS.logo + INFO_BLOCK_GAP : 0)
  )
}

export function hasOptionalInfoBlockColumns(columns: InfoBlockColumns = {}): boolean {
  return columns.inspectionAgency === true || columns.logo === true
}

export function isInspectionAgencyInfoBlockVisible(project: unknown): boolean {
  return (
    (project as { project?: { showInspectionAgencyInInfoBlock?: boolean } } | null | undefined)
      ?.project?.showInspectionAgencyInInfoBlock === true
  )
}

/** Columns for a project; the logo column needs the caller's access-filtered installer profile. */
export function getInfoBlockColumns(
  project: unknown,
  options: { hasLogo?: boolean } = {}
): InfoBlockColumns {
  return {
    inspectionAgency: isInspectionAgencyInfoBlockVisible(project),
    logo: options.hasLogo === true,
  }
}

/** Column order, left to right: inspection agency, logo, installer, address, general. */
export function getInfoBlockColumnPositions(columns: InfoBlockColumns = {}): {
  inspectionAgency: number | null
  logo: number | null
  installer: number
  address: number
  general: number
  separators: number[]
} {
  const separators: number[] = []
  let cursor = 0
  const place = (width: number): number => {
    const x = cursor
    cursor += width + INFO_BLOCK_GAP
    separators.push(cursor - INFO_BLOCK_GAP / 2)
    return x
  }
  const inspectionAgency = columns.inspectionAgency
    ? place(INFO_BLOCK_BOX_WIDTHS.inspectionAgency)
    : null
  const logo = columns.logo ? place(INFO_BLOCK_BOX_WIDTHS.logo) : null
  const installer = place(INFO_BLOCK_BOX_WIDTHS.installer)
  const address = place(INFO_BLOCK_BOX_WIDTHS.address)
  const general = cursor
  return { inspectionAgency, logo, installer, address, general, separators }
}

/** Height-building blocks (px). Adjust to change total frame height. */
export const INFO_BLOCK_INSTALLER_TOP_HEIGHT = 30
export const INFO_BLOCK_IMAGE_AREA_HEIGHT = 44
export const INFO_BLOCK_MADE_WITH_HEIGHT = 10
export const INFO_BLOCK_INSTALLER_HEIGHT =
  INFO_BLOCK_INSTALLER_TOP_HEIGHT +
  INFO_BLOCK_IMAGE_AREA_HEIGHT +
  INFO_BLOCK_MADE_WITH_HEIGHT +
  INFO_BLOCK_PADDING * 2

/** Total block height (all three columns use this). */
export const INFO_BLOCK_HEIGHT = INFO_BLOCK_INSTALLER_HEIGHT

/** Margin between info block and panel frame edge (used for min frame size and positioning). */
export const INFO_BLOCK_FRAME_MARGIN = 10

/** Minimum panel frame width/height so the info block fits inside. Use in layout for dynamic min size. */
export function getInfoBlockMinFrameSize(columns: InfoBlockColumns = {}): {
  minWidth: number
  minHeight: number
} {
  return {
    minWidth: getInfoBlockTotalWidth(columns) + INFO_BLOCK_FRAME_MARGIN * 2,
    minHeight: INFO_BLOCK_HEIGHT + INFO_BLOCK_FRAME_MARGIN * 2,
  }
}

export function formatInspectionAgencyDetails(
  agency: ProjectPartyContact | undefined,
  countryDisplay?: string
): string {
  if (!agency) return ''
  const address = agency.address
  const street = address ? [address.street, address.number].filter(Boolean).join(' ').trim() : ''
  const country = address
    ? (address.country === 'BE' || !address.country) && countryDisplay
      ? countryDisplay
      : address.country
    : ''
  const parts = address
    ? [street, `${address.postalCode} ${address.city}`.trim(), country].filter(Boolean)
    : []
  const displayPhone = pickInstallerDisplayPhone(agency.phone, agency.mobile)
  if (displayPhone) parts.push(displayPhone)
  const email = agency.email?.trim()
  if (email) parts.push(email)
  return parts.join('\n')
}

/** Vertical step per row in the general column (page, date, voltage, EAN). */
export const INFO_BLOCK_GENERAL_ROW_HEIGHT = 22

/** Optional display label for country when it is BE (e.g. "Belgium" / "België" / "Belgique"). */
export function formatInstallationAddress(
  installation: Installation,
  countryDisplay?: string
): string {
  const a = installation.address
  const country = a.country === 'BE' && countryDisplay ? countryDisplay : a.country
  const parts = [a.street, `${a.postalCode} ${a.city}`.trim(), country].filter(Boolean)
  return parts.join('\n')
}

/** Pick one phone for display: mobile over landline when both are set. */
export function pickInstallerDisplayPhone(phone?: string, mobile?: string): string {
  const mobileTrimmed = mobile?.trim() ?? ''
  const phoneTrimmed = phone?.trim() ?? ''
  if (mobileTrimmed) return mobileTrimmed
  if (phoneTrimmed) return phoneTrimmed
  return ''
}

export type InstallerAddressContact = {
  phone?: string
  mobile?: string
  email?: string
}

/** Format installer address for display (e.g. in InfoBlock). Pass countryDisplay for BE (e.g. "Belgium"). */
export function formatInstallerAddress(
  address: { street: string; postalCode: string; city: string; country?: string },
  countryDisplay?: string,
  contact?: InstallerAddressContact
): string {
  const country =
    (address.country === 'BE' || !address.country) && countryDisplay
      ? countryDisplay
      : address.country || 'BE'
  const parts = [address.street, `${address.postalCode} ${address.city}`.trim(), country].filter(
    Boolean
  )
  const displayPhone = contact ? pickInstallerDisplayPhone(contact.phone, contact.mobile) : ''
  if (displayPhone) parts.push(displayPhone)
  const email = contact?.email?.trim() ?? ''
  if (email) parts.push(email)
  return parts.join('\n')
}

export function getVoltageLabel(installation: Installation): string {
  const label = getVoltageSummaryLabel(installation.nominalVoltage)
  return `${label} 50 Hz`
}

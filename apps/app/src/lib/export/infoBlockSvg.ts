import { getInfoBlockContent } from '@/lib/infoBlockContent'
/**
 * Renders the info block (installer, installation address, general) as SVG for PDF export.
 * Layout and dimensions match InfoBlock.tsx / infoBlockLayout.ts (single source of truth).
 */

import {
  resolveInfoBlockPresentation,
  type InfoBlockPresentationPreferences,
} from '@/lib/infoBlockPresentation'
import type { InstallerProfile } from '@/lib/installerProfile'
import type { ProjectPartyContact } from '@/types/schema'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import {
  INFO_BLOCK_BOX_WIDTHS,
  INFO_BLOCK_PADDING,
  INFO_BLOCK_STROKE_WIDTH_FRAME,
  INFO_BLOCK_STROKE_WIDTH_SEPARATOR,
  INFO_BLOCK_FONT_SIZE_HEADER,
  INFO_BLOCK_FONT_SIZE_NAME,
  INFO_BLOCK_FONT_SIZE_BODY,
  INFO_BLOCK_FONT_SIZE_MADE_WITH,
  INFO_BLOCK_HEADER_LINE_GAP,
  INFO_BLOCK_BODY_TOP_GAP,
  INFO_BLOCK_HEADER_LINE_INSET,
  INFO_BLOCK_BODY_LINE_HEIGHT,
  INFO_BLOCK_INSTALLER_TOP_HEIGHT,
  INFO_BLOCK_IMAGE_AREA_HEIGHT,
  getInfoBlockColumnPositions,
  getInfoBlockColumns,
  getInfoBlockTotalWidth,
  getVoltageLabel,
} from '@/lib/infoBlockLayout'
import { getThemeColors } from '@/lib/theme/colors'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

export interface InfoBlockSvgOptions {
  profile: InstallerProfile | null
  project:
    | (ProjectWithOptionalV2Electrical & {
        project?: InfoBlockPresentationPreferences & {
          name?: string
          meterEanCode?: string
          updatedAt?: string
          inspectionAgency?: ProjectPartyContact
          showInspectionAgencyInInfoBlock?: boolean
        }
      })
    | null
  viewTitle: string
  /** Column header for installer column (e.g. "Installer") */
  headerInstaller: string
  /** Column header for address column (e.g. "Installation address") */
  headerInstallation: string
  /** Column header for the optional inspection-agency column. */
  headerInspectionAgency: string
  /** Light theme = false, dark = true */
  isDark: boolean
  fontFamily: string
  countryLabel: string
  madeWithText: string
  canCustomizeInfoBlock?: boolean
}

/**
 * Build an SVG string for the info block at its content-driven native width and height.
 * The caller scales and positions it on the PDF page.
 */
export function buildInfoBlockSvg(options: InfoBlockSvgOptions): string {
  const {
    profile,
    project,
    viewTitle,
    headerInstaller: defaultHeaderInstaller,
    headerInstallation,
    headerInspectionAgency,
    isDark,
    fontFamily,
    countryLabel,
    madeWithText: defaultMadeWithText,
  } = options

  const { headerInstaller, madeWithText } = resolveInfoBlockPresentation(
    project?.project,
    {
      headerInstaller: defaultHeaderInstaller,
      madeWithText: defaultMadeWithText,
    },
    options.canCustomizeInfoBlock === true,
  )

  const content = getInfoBlockContent(project, profile, countryLabel, fontFamily)
  const infoBlockHeight = content.height
  const colors = getThemeColors(isDark ? 'dark' : 'light')
  const frameColor = colors.frameColor
  const textColor = colors.textColor
  const secondaryColor = colors.secondaryText

  const columns = getInfoBlockColumns(project, { hasLogo: Boolean(profile?.logoDataUrl) })
  const infoBlockWidth = getInfoBlockTotalWidth(columns)
  const columnPositions = getInfoBlockColumnPositions(columns)
  const inspectionAgencyBoxX = columnPositions.inspectionAgency
  const logoBoxX = columnPositions.logo
  const installerBoxX = columnPositions.installer
  const addressBoxX = columnPositions.address
  const generalBoxX = columnPositions.general

  const headerY = INFO_BLOCK_PADDING
  const headerLineY = headerY + INFO_BLOCK_FONT_SIZE_HEADER + INFO_BLOCK_HEADER_LINE_GAP
  const bodyStartY = headerLineY + INFO_BLOCK_BODY_TOP_GAP

  const sepTopY = INFO_BLOCK_PADDING
  const sepBottomY = infoBlockHeight - INFO_BLOCK_PADDING
  const col1Left = installerBoxX
  const col1Right = installerBoxX + INFO_BLOCK_BOX_WIDTHS.installer
  const col2Left = addressBoxX
  const col2Right = addressBoxX + INFO_BLOCK_BOX_WIDTHS.address
  const col3Left = generalBoxX
  const col3Right = generalBoxX + INFO_BLOCK_BOX_WIDTHS.general

  const halfImageHeight = INFO_BLOCK_IMAGE_AREA_HEIGHT / 2
  const imageAreaY = INFO_BLOCK_PADDING + INFO_BLOCK_INSTALLER_TOP_HEIGHT
  const signatureY = imageAreaY + halfImageHeight

  const installation = project ? getProjectElectricalInstallation(project) : undefined
  const voltageText = installation
    ? getVoltageLabel(installation, project ? getProjectElectricalPanels(project) : [])
    : ''
  const eanText = project?.project?.meterEanCode ?? ''
  const updatedAt = project?.project?.updatedAt
  const dateText = updatedAt
    ? new Date(updatedAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
    : ''
  const eanDisplay =
    eanText && eanText.trim().length > 0
      ? /^EAN/i.test(eanText.trim())
        ? eanText
        : `EAN ${eanText}`
      : ''

  const inspectionAgency = project?.project?.inspectionAgency
  const inspectionAgencyCompanyNumber = inspectionAgency?.companyNumber?.trim() ?? ''

  const lines: string[] = []

  // Root SVG
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${infoBlockWidth}" height="${infoBlockHeight}" viewBox="0 0 ${infoBlockWidth} ${infoBlockHeight}">`
  )
  lines.push(
    `<rect x="0" y="0" width="${infoBlockWidth}" height="${infoBlockHeight}" fill="none" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_FRAME}"/>`
  )
  columnPositions.separators.forEach((separatorX) => {
    lines.push(
      `<line x1="${separatorX}" y1="${sepTopY}" x2="${separatorX}" y2="${sepBottomY}" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_SEPARATOR}"/>`
    )
  })

  if (inspectionAgencyBoxX != null) {
    const inspectionRight = inspectionAgencyBoxX + INFO_BLOCK_BOX_WIDTHS.inspectionAgency
    lines.push(
      `<text x="${inspectionAgencyBoxX + INFO_BLOCK_PADDING}" y="${headerY + INFO_BLOCK_FONT_SIZE_HEADER}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_HEADER}" font-weight="bold" fill="${textColor}">${escapeXml(headerInspectionAgency)}</text>`
    )
    lines.push(
      `<line x1="${inspectionAgencyBoxX + INFO_BLOCK_HEADER_LINE_INSET}" y1="${headerLineY}" x2="${inspectionRight - INFO_BLOCK_HEADER_LINE_INSET}" y2="${headerLineY}" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_SEPARATOR}"/>`
    )
    content.inspectionAgency.nameLines.forEach((line, index) => {
      lines.push(`<text x="${inspectionAgencyBoxX + INFO_BLOCK_PADDING}" y="${bodyStartY + INFO_BLOCK_FONT_SIZE_NAME + index * 12}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="8" font-weight="bold" fill="${textColor}">${escapeXml(line)}</text>`)
    })
    if (inspectionAgencyCompanyNumber) {
      lines.push(
        `<text x="${inspectionRight - INFO_BLOCK_PADDING}" y="${bodyStartY + 6}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="6" font-style="italic" fill="${secondaryColor}" fill-opacity="0.8" text-anchor="end">${escapeXml(inspectionAgencyCompanyNumber)}</text>`
      )
    }
    content.inspectionAgency.detailLines.forEach((line, index) => {
      const y =
        bodyStartY +
        content.inspectionAgency.nameHeight +
        INFO_BLOCK_FONT_SIZE_BODY +
        index * INFO_BLOCK_BODY_LINE_HEIGHT
      lines.push(
        `<text x="${inspectionAgencyBoxX + INFO_BLOCK_PADDING}" y="${y}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_BODY}" fill="${secondaryColor}">${escapeXml(line)}</text>`
      )
    })
  }

  if (logoBoxX != null && profile?.logoDataUrl) {
    lines.push(
      `<image href="${profile.logoDataUrl}" x="${logoBoxX + INFO_BLOCK_PADDING}" y="${INFO_BLOCK_PADDING}" width="${INFO_BLOCK_BOX_WIDTHS.logo - INFO_BLOCK_PADDING * 2}" height="${infoBlockHeight - INFO_BLOCK_PADDING * 2}" preserveAspectRatio="xMidYMid meet"/>`
    )
  }

  // Installer column
  lines.push(
    `<text x="${installerBoxX + INFO_BLOCK_PADDING}" y="${headerY + INFO_BLOCK_FONT_SIZE_HEADER}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_HEADER}" font-weight="bold" fill="${textColor}">${escapeXml(headerInstaller)}</text>`
  )
  lines.push(
    `<line x1="${col1Left + INFO_BLOCK_HEADER_LINE_INSET}" y1="${headerLineY}" x2="${col1Right - INFO_BLOCK_HEADER_LINE_INSET}" y2="${headerLineY}" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_SEPARATOR}"/>`
  )
  content.installer.nameLines.forEach((line, index) => {
    lines.push(`<text x="${installerBoxX + INFO_BLOCK_PADDING}" y="${bodyStartY + 8 + index * 12}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="8" font-weight="bold" fill="${textColor}">${escapeXml(line)}</text>`)
  })
  content.installer.detailLines.forEach((line, index) => {
    lines.push(`<text x="${installerBoxX + INFO_BLOCK_PADDING}" y="${bodyStartY + content.installer.nameHeight + 7 + index * 12}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="7" fill="${secondaryColor}">${escapeXml(line)}</text>`)
  })
  // Signature
  if (profile?.signatureDataUrl) {
    lines.push(
      `<image href="${profile.signatureDataUrl}" x="${installerBoxX + INFO_BLOCK_BOX_WIDTHS.installer - INFO_BLOCK_PADDING - 50}" y="${signatureY}" width="50" height="${halfImageHeight}" preserveAspectRatio="xMidYMid meet"/>`
    )
  }
  // Made-with text: right-aligned at bottom of installer column
  if (madeWithText) lines.push(
    `<text x="${col1Right - INFO_BLOCK_PADDING}" y="${infoBlockHeight - INFO_BLOCK_PADDING}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_MADE_WITH}" fill="${secondaryColor}" text-anchor="end">${escapeXml(madeWithText)}</text>`
  )

  // Address column
  lines.push(
    `<text x="${addressBoxX + INFO_BLOCK_PADDING}" y="${headerY + INFO_BLOCK_FONT_SIZE_HEADER}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_HEADER}" font-weight="bold" fill="${textColor}">${escapeXml(headerInstallation)}</text>`
  )
  lines.push(
    `<line x1="${col2Left + INFO_BLOCK_HEADER_LINE_INSET}" y1="${headerLineY}" x2="${col2Right - INFO_BLOCK_HEADER_LINE_INSET}" y2="${headerLineY}" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_SEPARATOR}"/>`
  )
  content.address.nameLines.forEach((line, index) => {
    lines.push(`<text x="${addressBoxX + INFO_BLOCK_PADDING}" y="${bodyStartY + 8 + index * 12}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="8" font-weight="bold" fill="${textColor}">${escapeXml(line)}</text>`)
  })
  content.address.detailLines.forEach((line, index) => {
    lines.push(`<text x="${addressBoxX + INFO_BLOCK_PADDING}" y="${bodyStartY + content.address.nameHeight + 7 + index * 12}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="7" fill="${textColor}">${escapeXml(line)}</text>`)
  })

  // General column
  lines.push(
    `<text x="${generalBoxX + INFO_BLOCK_PADDING}" y="${headerY + INFO_BLOCK_FONT_SIZE_HEADER}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_HEADER}" font-weight="bold" fill="${textColor}">${escapeXml(viewTitle)}</text>`
  )
  lines.push(
    `<line x1="${col3Left + INFO_BLOCK_HEADER_LINE_INSET}" y1="${headerLineY}" x2="${col3Right - INFO_BLOCK_HEADER_LINE_INSET}" y2="${headerLineY}" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_SEPARATOR}"/>`
  )
  // General column: date, voltage, EAN. SVG y is baseline; add fontSize so text top matches canvas (centerOffset from section top).
  const sectionsCount = 3
  const availableHeight = infoBlockHeight - INFO_BLOCK_PADDING - bodyStartY
  const sectionHeight = availableHeight / sectionsCount
  const centerOffset = (sectionHeight - INFO_BLOCK_FONT_SIZE_BODY) / 2
  const dateY = bodyStartY + centerOffset + INFO_BLOCK_FONT_SIZE_BODY
  const voltageY = bodyStartY + sectionHeight + centerOffset + INFO_BLOCK_FONT_SIZE_BODY
  const eanY = bodyStartY + sectionHeight * 2 + centerOffset + INFO_BLOCK_FONT_SIZE_BODY
  const divider1Y = bodyStartY + sectionHeight
  const divider2Y = bodyStartY + sectionHeight * 2

  lines.push(
    `<text x="${generalBoxX + INFO_BLOCK_PADDING}" y="${dateY}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_BODY}" fill="${textColor}">${escapeXml(dateText)}</text>`
  )
  lines.push(
    `<text x="${generalBoxX + INFO_BLOCK_PADDING}" y="${voltageY}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_BODY}" fill="${textColor}">${escapeXml(voltageText)}</text>`
  )
  lines.push(
    `<line x1="${col3Left + INFO_BLOCK_HEADER_LINE_INSET}" y1="${divider1Y}" x2="${col3Right - INFO_BLOCK_HEADER_LINE_INSET}" y2="${divider1Y}" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_SEPARATOR}"/>`
  )
  lines.push(
    `<line x1="${col3Left + INFO_BLOCK_HEADER_LINE_INSET}" y1="${divider2Y}" x2="${col3Right - INFO_BLOCK_HEADER_LINE_INSET}" y2="${divider2Y}" stroke="${frameColor}" stroke-width="${INFO_BLOCK_STROKE_WIDTH_SEPARATOR}"/>`
  )
  lines.push(
    `<text x="${generalBoxX + INFO_BLOCK_PADDING}" y="${eanY}" font-family="${escapeXml(fontFamily)}, sans-serif" font-size="${INFO_BLOCK_FONT_SIZE_BODY}" fill="${textColor}">${escapeXml(eanDisplay)}</text>`
  )

  lines.push('</svg>')
  return lines.join('')
}

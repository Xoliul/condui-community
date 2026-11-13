import type { InstallerProfile } from '@/lib/installerProfile'
import type { ProjectPartyContact } from '@/types/schema'
import type { ProjectV2 } from '@/types/projectV2'
import { getProjectElectricalInstallation, type ProjectWithOptionalV2Electrical } from '@/lib/projectV2/electrical'
import { measureTextWidth } from '@/lib/wireTextLabel'
import {
  formatInstallationAddress, formatInstallerAddress, formatInspectionAgencyDetails,
  INFO_BLOCK_BOX_WIDTHS, INFO_BLOCK_PADDING, INFO_BLOCK_HEIGHT,
  INFO_BLOCK_BODY_LINE_HEIGHT, INFO_BLOCK_MADE_WITH_HEIGHT,
  isInspectionAgencyInfoBlockVisible, INFO_BLOCK_FONT_SIZE_HEADER,
  INFO_BLOCK_FONT_SIZE_NAME, INFO_BLOCK_FONT_SIZE_BODY,
  INFO_BLOCK_HEADER_LINE_GAP, INFO_BLOCK_BODY_TOP_GAP,
} from './infoBlockLayout'

type ContentProject = ProjectWithOptionalV2Electrical & {
  project?: { name?: string; inspectionAgency?: ProjectPartyContact; installerOverride?: ProjectV2['project']['installerOverride'] }
}

/** Headless callers have the portable installer override, rather than an account profile. */
export function getProjectInfoBlockHeight(project: ContentProject): number {
  const override = project.project?.installerOverride
  const profile = override ? { ...override, companyNumber: override.companyNumber ?? '',
    email: override.email ?? '', mobile: override.mobile ?? '', phone: override.phone ?? '' } : null
  return getInfoBlockContent(project, profile, 'BE', 'Figtree').height
}

/** Explicit lines shared by Konva and SVG, including character breaks in long emails. */
export function wrapInfoBlockText(text: string, width: number, font: string, size: number): string[] {
  return text.split('\n').flatMap((paragraph) => {
    const lines: string[] = []
    let rest = paragraph.trim()
    while (rest) {
      const characters = Array.from(rest)
      // Reserve spacing for bold names and canvas letter spacing, too.
      let low = 1
      let high = characters.length
      let end = 1
      while (low <= high) {
        const candidate = Math.floor((low + high) / 2)
        const measured = measureTextWidth(characters.slice(0, candidate).join(''), font, size)
        if (measured * 1.1 + candidate * 0.5 <= width) {
          end = candidate
          low = candidate + 1
        } else high = candidate - 1
      }
      if (end < characters.length) {
        const space = characters.slice(0, end + 1).lastIndexOf(' ')
        if (space > 0) end = space
      }
      lines.push(characters.slice(0, end).join('').trimEnd())
      rest = characters.slice(end).join('').trimStart()
    }
    return lines.length ? lines : ['']
  })
}

export function getInfoBlockContent(
  project: ContentProject | null,
  profile: InstallerProfile | null,
  countryLabel = 'BE',
  fontFamily = 'Arial',
) {
  const column = (name: string, details: string, width: number, nameWidth = width) => {
    const nameLines = wrapInfoBlockText(name, nameWidth, fontFamily, INFO_BLOCK_FONT_SIZE_NAME)
    const detailLines = wrapInfoBlockText(details, width, fontFamily, INFO_BLOCK_FONT_SIZE_BODY)
    return { nameLines, detailLines, nameHeight: nameLines.length * INFO_BLOCK_BODY_LINE_HEIGHT,
      height: (nameLines.length + detailLines.length) * INFO_BLOCK_BODY_LINE_HEIGHT }
  }
  const installerWidth = INFO_BLOCK_BOX_WIDTHS.installer - INFO_BLOCK_PADDING * 2 -
    (profile?.signatureDataUrl ? 58 : 0)
  const installer = column(profile?.name ?? '', profile
    ? formatInstallerAddress(profile.address, countryLabel, profile) : '', installerWidth)
  const installation = project ? getProjectElectricalInstallation(project) : undefined
  const address = column(project?.project?.name ?? '', installation
    ? formatInstallationAddress(installation, countryLabel) : '', INFO_BLOCK_BOX_WIDTHS.address - INFO_BLOCK_PADDING * 2)
  const agency = project?.project?.inspectionAgency
  const inspectionAgency = column(agency?.name ?? '', formatInspectionAgencyDetails(agency, countryLabel),
    INFO_BLOCK_BOX_WIDTHS.inspectionAgency - INFO_BLOCK_PADDING * 2,
    INFO_BLOCK_BOX_WIDTHS.inspectionAgency - INFO_BLOCK_PADDING * 2 - (agency?.companyNumber?.trim() ? 66 : 0))
  const bodyStartY = INFO_BLOCK_PADDING + INFO_BLOCK_FONT_SIZE_HEADER +
    INFO_BLOCK_HEADER_LINE_GAP + INFO_BLOCK_BODY_TOP_GAP
  const height = Math.max(INFO_BLOCK_HEIGHT,
    bodyStartY + installer.height + INFO_BLOCK_MADE_WITH_HEIGHT + INFO_BLOCK_PADDING,
    bodyStartY + address.height + INFO_BLOCK_PADDING,
    project && isInspectionAgencyInfoBlockVisible(project)
      ? bodyStartY + inspectionAgency.height + INFO_BLOCK_PADDING : 0)
  return { installer, address, inspectionAgency, height }
}

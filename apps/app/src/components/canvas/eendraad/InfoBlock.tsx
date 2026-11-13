import { memo, useCallback } from 'react'
import { useSignatureImage } from '@/hooks/useSignatureImage'
import { getInfoBlockContent } from '@/lib/infoBlockContent'
import { useEditionFeatureAvailability } from '@/hooks/useEditionFeatureAvailability'
import {
  resolveInfoBlockPresentation,
  type InfoBlockPresentationPreferences,
} from '@/lib/infoBlockPresentation'
import { ZOOM_100 } from '@/constants/canvasConstants'
import { Group, Rect, Text, Image, Line } from 'react-konva'
import { useTranslation } from 'react-i18next'
import { useSettingsStore } from '@/stores/settingsStore'
import { getInfoBlockBrandForCurrentDomain } from '@/utils/language'
import { useUIStore } from '@/stores/uiStore'
import {
  useCanvasFontFamily,
  useEffectiveCanvasZoom,
  useInfoBlockBoxSelected,
  useSetSelection,
} from '@/editions/community/communityHooks'
import { useThemeColors } from '@/lib/theme/hooks'
import { useInfoBlockLogoImage } from '@/hooks/eendraad/useInfoBlockLogoImage'
import {
  getFrameColor,
  getTextColor,
  getSecondaryTextColor,
  getEendraadSelectionRectProps,
} from './canvasSymbols'
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
  INFO_BLOCK_INSTALLER_TOP_HEIGHT,
  INFO_BLOCK_IMAGE_AREA_HEIGHT,
  INFO_BLOCK_GENERAL_ROW_HEIGHT,
  getInfoBlockColumnPositions,
  getInfoBlockColumns,
  getInfoBlockTotalWidth,
  getVoltageLabel,
} from '@/lib/infoBlockLayout'
import {
  getProjectElectricalInstallation,
  getProjectElectricalPanels,
  type ProjectWithOptionalV2Electrical,
} from '@/lib/projectV2/electrical'
import type { InstallerProfile } from '@/lib/installerProfile'
import type { ProjectPartyContact } from '@/types/schema'

export type InfoBlockBoxId = 'installer' | 'address' | 'ean'

type InfoBlockProject = ProjectWithOptionalV2Electrical & {
  project?: InfoBlockPresentationPreferences & {
    id?: string
    name?: string
    meterEanCode?: string
    updatedAt?: string
    inspectionAgency?: ProjectPartyContact
    showInspectionAgencyInInfoBlock?: boolean
  }
}

interface InfoBlockProps {
  x: number
  y: number
  /** Localized title for the third column (depends on view/export context). */
  viewTitle: string
  project: InfoBlockProject | null
  profile: InstallerProfile | null
  /** Show page number row (for PDF export only). */
  showPageNumber?: boolean
  pageNumber?: number
  /** If false, boxes are clickable and show selection (live editing). */
  interactive?: boolean
  /** Tiny live diagrams retain selectable columns without unreadable text/image nodes. */
  overview?: boolean
}

export const InfoBlock = memo(function InfoBlock({
  x,
  y,
  viewTitle,
  project,
  profile,
  showPageNumber = false,
  pageNumber,
  interactive = true,
  overview = false,
}: InfoBlockProps) {
  const { t } = useTranslation()
  const theme = useSettingsStore((state) => state.theme)
  const language = useSettingsStore((state) => state.language)
  const fontFamily = useCanvasFontFamily()
  const colors = useThemeColors()
  const setSelection = useSetSelection()
  const installerSelected = useInfoBlockBoxSelected('installer', interactive)
  const addressSelected = useInfoBlockBoxSelected('address', interactive)
  const eanSelected = useInfoBlockBoxSelected('ean', interactive)
  const canvasZoom = useEffectiveCanvasZoom(ZOOM_100, 'eendraad')
  const isDark = theme.mode === 'dark'
  const frameColor = getFrameColor(isDark)
  const textColor = getTextColor(isDark)
  const secondaryColor = getSecondaryTextColor(isDark)

  const logoImage = useInfoBlockLogoImage(profile?.logoDataUrl)
  const signatureImage = useSignatureImage(profile?.signatureDataUrl, isDark)
  const fitImageInBox = useCallback(
    (
      image: HTMLImageElement | null,
      boxWidth: number,
      boxHeight: number,
      boxX: number,
      boxY: number
    ) => {
      if (!image || !image.width || !image.height) {
        return { x: boxX, y: boxY, width: boxWidth, height: boxHeight }
      }
      const imageRatio = image.width / image.height
      const boxRatio = boxWidth / boxHeight
      if (imageRatio > boxRatio) {
        const width = boxWidth
        const height = width / imageRatio
        return { x: boxX, y: boxY + (boxHeight - height) / 2, width, height }
      }
      const height = boxHeight
      const width = height * imageRatio
      return { x: boxX + (boxWidth - width) / 2, y: boxY, width, height }
    },
    []
  )

  const countryLabel = t('installation.countryBelgium', 'Belgium')
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

  const madeWithKey = 'infoBlock.madeWith'
  const infoBlockBrand = getInfoBlockBrandForCurrentDomain(language)
  const { installerBranding } = useEditionFeatureAvailability(project?.project?.id)
  const { headerInstaller, madeWithText } = resolveInfoBlockPresentation(
    project?.project,
    {
      headerInstaller: t('infoBlock.headerInstaller', 'Installer'),
      madeWithText: t(madeWithKey, { brand: infoBlockBrand }),
    },
    installerBranding,
  )

  const headerInstallation = t('infoBlock.headerInstallation', 'Installation address')
  const headerInspectionAgency = t('project.inspectionAgency', 'Inspection agency')
  const columns = getInfoBlockColumns(project, { hasLogo: logoImage != null })
  const inspectionAgency = project?.project?.inspectionAgency
  const inspectionAgencyCompanyNumber = inspectionAgency?.companyNumber?.trim() ?? ''
  const content = getInfoBlockContent(project, profile, countryLabel, fontFamily)
  const infoBlockHeight = content.height
  const infoBlockWidth = getInfoBlockTotalWidth(columns)

  const isSelected = (id: InfoBlockBoxId) =>
    id === 'installer' ? installerSelected : id === 'address' ? addressSelected : eanSelected

  const handleBoxClick = useCallback(
    (e: { cancelBubble?: boolean }, id: InfoBlockBoxId) => {
      if (e.cancelBubble !== undefined) e.cancelBubble = true
      if (!interactive) return
      setSelection({ type: 'infoBlock', ids: [id] })
      const { panels, togglePanel: doToggle } = useUIStore.getState()
      if (!panels.properties.visible) doToggle('properties')
    },
    [interactive, setSelection]
  )

  const columnPositions = getInfoBlockColumnPositions(columns)
  const inspectionAgencyBoxX = columnPositions.inspectionAgency
  const logoBoxX = columnPositions.logo
  const installerBoxX = columnPositions.installer
  const addressBoxX = columnPositions.address
  const generalBoxX = columnPositions.general

  // Header + separators layout (all from infoBlockLayout for easy tweaking)
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
  const mediaBoxWidth = 50
  const mediaBoxX =
    installerBoxX + INFO_BLOCK_BOX_WIDTHS.installer - INFO_BLOCK_PADDING - mediaBoxWidth
  const installerTextWidth =
    INFO_BLOCK_BOX_WIDTHS.installer -
    INFO_BLOCK_PADDING * 2 -
    (signatureImage ? mediaBoxWidth + INFO_BLOCK_PADDING : 0)
  const logoRect =
    logoBoxX != null
      ? fitImageInBox(
          logoImage,
          INFO_BLOCK_BOX_WIDTHS.logo - INFO_BLOCK_PADDING * 2,
          infoBlockHeight - INFO_BLOCK_PADDING * 2,
          logoBoxX + INFO_BLOCK_PADDING,
          INFO_BLOCK_PADDING
        )
      : null
  const signatureRect = fitImageInBox(
    signatureImage,
    mediaBoxWidth,
    halfImageHeight,
    mediaBoxX,
    signatureY
  )
  const headerLetterSpacing = 0.5
  const installerAddressY = bodyStartY + content.installer.nameHeight
  const inspectionAgencyMetaWidth = inspectionAgencyCompanyNumber ? 66 : 0
  const inspectionAgencyNameWidth =
    INFO_BLOCK_BOX_WIDTHS.inspectionAgency - INFO_BLOCK_PADDING * 2 - inspectionAgencyMetaWidth
  const inspectionAgencyDetailsY = bodyStartY + content.inspectionAgency.nameHeight

  if (overview && !installerSelected && !addressSelected && !eanSelected) {
    const sectionsTop = bodyStartY + (showPageNumber && pageNumber != null ? INFO_BLOCK_GENERAL_ROW_HEIGHT : 0)
    const sectionHeight = (infoBlockHeight - INFO_BLOCK_PADDING - sectionsTop) / 3
    return (
      <Group name="export-info-block" x={x} y={y} listening={interactive}>
        <Rect width={infoBlockWidth} height={infoBlockHeight}
          stroke={frameColor} strokeWidth={INFO_BLOCK_STROKE_WIDTH_FRAME}
          fill={colors.background} listening={false} />
        {columnPositions.separators.map((separatorX) => (
          <Line key={separatorX} points={[separatorX, sepTopY, separatorX, sepBottomY]}
            stroke={frameColor} strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR} listening={false} />
        ))}
        {interactive && (['logo', 'installer', 'address', 'general'] as const).map((column) => {
          const columnX = columnPositions[column]
          if (columnX == null) return null
          const id = column === 'general' ? 'ean' : column === 'logo' ? 'installer' : column
          return (
            <Rect key={column} x={columnX} width={INFO_BLOCK_BOX_WIDTHS[column]}
              y={column === 'general' ? sectionsTop + sectionHeight * 2 : 0}
              height={column === 'general' ? sectionHeight : infoBlockHeight} fill="transparent"
              onClick={(event) => handleBoxClick(event, id)}
              onTap={(event) => handleBoxClick(event, id)} />
          )
        })}
      </Group>
    )
  }

  return (
    <Group name="export-info-block" x={x} y={y} listening={interactive}>
      {/* Main outer frame */}
      <Rect
        x={0}
        y={0}
        width={infoBlockWidth}
        height={infoBlockHeight}
        stroke={frameColor}
        strokeWidth={INFO_BLOCK_STROKE_WIDTH_FRAME}
        fill={colors.background}
        listening={false}
      />

      {/* Vertical separators between columns (thin, with margin from top/bottom) */}
      {columnPositions.separators.map((separatorX) => (
        <Line
          key={`separator-${separatorX}`}
          points={[separatorX, sepTopY, separatorX, sepBottomY]}
          stroke={frameColor}
          strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR}
          listening={false}
        />
      ))}

      {inspectionAgencyBoxX != null && (
        <Group>
          <Text
            x={inspectionAgencyBoxX + INFO_BLOCK_PADDING}
            y={headerY}
            text={headerInspectionAgency}
            fontSize={INFO_BLOCK_FONT_SIZE_HEADER}
            fontFamily={fontFamily}
            fontStyle="bold"
            fill={textColor}
            listening={false}
            letterSpacing={headerLetterSpacing}
          />
          <Line
            points={[
              inspectionAgencyBoxX + INFO_BLOCK_HEADER_LINE_INSET,
              headerLineY,
              inspectionAgencyBoxX +
                INFO_BLOCK_BOX_WIDTHS.inspectionAgency -
                INFO_BLOCK_HEADER_LINE_INSET,
              headerLineY,
            ]}
            stroke={frameColor}
            strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR}
            listening={false}
          />
          <Text
            x={inspectionAgencyBoxX + INFO_BLOCK_PADDING}
            y={bodyStartY}
            text={content.inspectionAgency.nameLines.join('\n')}
            lineHeight={12 / 8}
            fontSize={INFO_BLOCK_FONT_SIZE_NAME}
            fontFamily={fontFamily}
            fontStyle="bold"
            fill={textColor}
            listening={false}
            width={inspectionAgencyNameWidth}
            wrap="none"
          />
          {inspectionAgencyCompanyNumber && (
            <Text
              x={
                inspectionAgencyBoxX +
                INFO_BLOCK_BOX_WIDTHS.inspectionAgency -
                INFO_BLOCK_PADDING -
                inspectionAgencyMetaWidth
              }
              y={bodyStartY}
              text={inspectionAgencyCompanyNumber}
              fontSize={6}
              fontFamily={fontFamily}
              fontStyle="italic"
              fill={secondaryColor}
              opacity={0.8}
              listening={false}
              width={inspectionAgencyMetaWidth}
              align="right"
              wrap="none"
              ellipsis={true}
            />
          )}
          <Text
            x={inspectionAgencyBoxX + INFO_BLOCK_PADDING}
            y={inspectionAgencyDetailsY}
            text={content.inspectionAgency.detailLines.join('\n')}
            fontSize={INFO_BLOCK_FONT_SIZE_BODY}
            fontFamily={fontFamily}
            fill={secondaryColor}
            listening={false}
            width={INFO_BLOCK_BOX_WIDTHS.inspectionAgency - INFO_BLOCK_PADDING * 2}
            wrap="none"
            lineHeight={12 / 7}
          />
        </Group>
      )}

      {/* Logo column when the effective installer profile includes an uploaded logo */}
      {logoBoxX != null && logoRect && logoImage && (
        <Group>
          {interactive && (
            <Rect
              x={logoBoxX}
              y={0}
              width={INFO_BLOCK_BOX_WIDTHS.logo}
              height={infoBlockHeight}
              fill="transparent"
              listening={true}
              onClick={(ev) => handleBoxClick(ev, 'installer')}
              onTap={(ev) => handleBoxClick(ev, 'installer')}
            />
          )}
          <Image
            image={logoImage}
            x={logoRect.x}
            y={logoRect.y}
            width={logoRect.width}
            height={logoRect.height}
            listening={false}
          />
        </Group>
      )}

      {/* Installer column */}
      <Group>
        {/* Header + underline */}
        <Text
          x={installerBoxX + INFO_BLOCK_PADDING}
          y={headerY}
          text={headerInstaller}
          fontSize={INFO_BLOCK_FONT_SIZE_HEADER}
          fontFamily={fontFamily}
          fontStyle="bold"
          fill={textColor}
          listening={false}
          letterSpacing={headerLetterSpacing}
        />
        <Line
          points={[
            col1Left + INFO_BLOCK_HEADER_LINE_INSET,
            headerLineY,
            col1Right - INFO_BLOCK_HEADER_LINE_INSET,
            headerLineY,
          ]}
          stroke={frameColor}
          strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR}
          listening={false}
        />

        {/* Hitbox + selection */}
        {interactive && (
          <Rect
            x={installerBoxX}
            y={0}
            width={INFO_BLOCK_BOX_WIDTHS.installer}
            height={infoBlockHeight}
            fill="transparent"
            listening={true}
            onClick={(ev) => handleBoxClick(ev, 'installer')}
            onTap={(ev) => handleBoxClick(ev, 'installer')}
          />
        )}
        {isSelected('installer') && (
          <Rect
            {...getEendraadSelectionRectProps(
              canvasZoom,
              installerBoxX,
              0,
              INFO_BLOCK_BOX_WIDTHS.installer,
              infoBlockHeight
            )}
          />
        )}

        {/* Installer name + address */}
        <Text
          x={installerBoxX + INFO_BLOCK_PADDING}
          y={bodyStartY}
          text={content.installer.nameLines.join('\n')}
          fontSize={INFO_BLOCK_FONT_SIZE_NAME}
          fontFamily={fontFamily}
          fontStyle="bold"
          fill={textColor}
          listening={false}
          width={installerTextWidth}
          wrap="none"
          lineHeight={12 / 8}
          letterSpacing={headerLetterSpacing}
        />
        <Text
          x={installerBoxX + INFO_BLOCK_PADDING}
          y={installerAddressY}
          text={content.installer.detailLines.join('\n')}
          fontSize={INFO_BLOCK_FONT_SIZE_BODY}
          fontFamily={fontFamily}
          fill={secondaryColor}
          listening={false}
          width={installerTextWidth}
          wrap="none"
          lineHeight={12 / 7}
        />
        {/* Signature (right side, lower half of the image area) */}
        {signatureImage && (
          <Image
            image={signatureImage}
            x={signatureRect.x}
            y={signatureRect.y}
            width={signatureRect.width}
            height={signatureRect.height}
            listening={false}
          />
        )}
        {madeWithText && <Text
          x={installerBoxX + INFO_BLOCK_PADDING}
          // Right-aligned in the bottom-right corner of the installer column,
          // sitting just above the bottom padding.
          y={infoBlockHeight - INFO_BLOCK_PADDING - INFO_BLOCK_FONT_SIZE_MADE_WITH}
          width={INFO_BLOCK_BOX_WIDTHS.installer - INFO_BLOCK_PADDING * 2}
          align="right"
          text={madeWithText}
          fontSize={INFO_BLOCK_FONT_SIZE_MADE_WITH}
          fontFamily={fontFamily}
          fill={secondaryColor}
          listening={false}
        />}
      </Group>

      {/* Address column */}
      <Group>
        {/* Header + underline */}
        <Text
          x={addressBoxX + INFO_BLOCK_PADDING}
          y={headerY}
          text={headerInstallation}
          fontSize={INFO_BLOCK_FONT_SIZE_HEADER}
          fontFamily={fontFamily}
          fontStyle="bold"
          fill={textColor}
          listening={false}
          letterSpacing={headerLetterSpacing}
        />
        <Line
          points={[
            col2Left + INFO_BLOCK_HEADER_LINE_INSET,
            headerLineY,
            col2Right - INFO_BLOCK_HEADER_LINE_INSET,
            headerLineY,
          ]}
          stroke={frameColor}
          strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR}
          listening={false}
        />

        {/* Hitbox + selection */}
        {interactive && (
          <Rect
            x={addressBoxX}
            y={0}
            width={INFO_BLOCK_BOX_WIDTHS.address}
            height={infoBlockHeight}
            fill="transparent"
            listening={true}
            onClick={(ev) => handleBoxClick(ev, 'address')}
            onTap={(ev) => handleBoxClick(ev, 'address')}
          />
        )}
        {isSelected('address') && (
          <Rect
            {...getEendraadSelectionRectProps(
              canvasZoom,
              addressBoxX,
              0,
              INFO_BLOCK_BOX_WIDTHS.address,
              infoBlockHeight
            )}
          />
        )}
        {/* Project name (same style as installer name) */}
        <Text
          x={addressBoxX + INFO_BLOCK_PADDING}
          y={bodyStartY}
          text={content.address.nameLines.join('\n')}
          lineHeight={12 / 8}
          wrap="none"
          fontSize={INFO_BLOCK_FONT_SIZE_NAME}
          fontFamily={fontFamily}
          fontStyle="bold"
          fill={textColor}
          listening={false}
          width={INFO_BLOCK_BOX_WIDTHS.address - INFO_BLOCK_PADDING * 2}
        />
        {/* Installation address text below project name */}
        <Text
          x={addressBoxX + INFO_BLOCK_PADDING}
          y={bodyStartY + content.address.nameHeight}
          text={content.address.detailLines.join('\n')}
          fontSize={INFO_BLOCK_FONT_SIZE_BODY}
          fontFamily={fontFamily}
          fill={textColor}
          listening={false}
          width={INFO_BLOCK_BOX_WIDTHS.address - INFO_BLOCK_PADDING * 2}
          wrap="none"
          lineHeight={12 / 7}
        />
      </Group>

      {/* General column (4 rows: page nr, date, voltage, EAN) */}
      <Group>
        {/* Header + underline (uses viewTitle prop) */}
        <Text
          x={generalBoxX + INFO_BLOCK_PADDING}
          y={headerY}
          text={viewTitle}
          fontSize={INFO_BLOCK_FONT_SIZE_HEADER}
          fontFamily={fontFamily}
          fontStyle="bold"
          fill={textColor}
          listening={false}
          letterSpacing={headerLetterSpacing}
        />
        <Line
          points={[
            col3Left + INFO_BLOCK_HEADER_LINE_INSET,
            headerLineY,
            col3Right - INFO_BLOCK_HEADER_LINE_INSET,
            headerLineY,
          ]}
          stroke={frameColor}
          strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR}
          listening={false}
        />
        {(() => {
          const rows: React.ReactNode[] = []
          let sectionsTop = bodyStartY

          // Optional page row (PDF export only) at fixed position above the equal-spaced sections
          if (showPageNumber && pageNumber != null) {
            rows.push(
              <Text
                key="page"
                x={generalBoxX + INFO_BLOCK_PADDING}
                y={sectionsTop}
                text={t('infoBlock.pageNr', 'Page') + ` ${pageNumber}`}
                fontSize={INFO_BLOCK_FONT_SIZE_BODY}
                fontFamily={fontFamily}
                fill={secondaryColor}
                listening={false}
              />
            )
            sectionsTop += INFO_BLOCK_GENERAL_ROW_HEIGHT
          }

          const sectionsCount = 3 // date, voltage, EAN
          const availableHeight = infoBlockHeight - INFO_BLOCK_PADDING - sectionsTop
          const sectionHeight = availableHeight / sectionsCount

          // Vertically center text in each section
          const centerOffset = (sectionHeight - INFO_BLOCK_FONT_SIZE_BODY) / 2

          const dateY = sectionsTop + centerOffset
          const voltageY = sectionsTop + sectionHeight + centerOffset
          const eanSectionTop = sectionsTop + sectionHeight * 2
          const eanY = eanSectionTop + centerOffset

          // Divider lines between sections
          const divider1Y = sectionsTop + sectionHeight
          const divider2Y = sectionsTop + sectionHeight * 2

          rows.push(
            <Text
              key="date"
              x={generalBoxX + INFO_BLOCK_PADDING}
              y={dateY}
              text={dateText}
              fontSize={INFO_BLOCK_FONT_SIZE_BODY}
              fontFamily={fontFamily}
              fill={textColor}
              listening={false}
            />
          )

          rows.push(
            <Text
              key="voltage"
              x={generalBoxX + INFO_BLOCK_PADDING}
              y={voltageY}
              text={voltageText}
              fontSize={INFO_BLOCK_FONT_SIZE_BODY}
              fontFamily={fontFamily}
              fill={textColor}
              listening={false}
            />
          )

          rows.push(
            <Line
              key="divider-1"
              points={[
                col3Left + INFO_BLOCK_HEADER_LINE_INSET,
                divider1Y,
                col3Right - INFO_BLOCK_HEADER_LINE_INSET,
                divider1Y,
              ]}
              stroke={frameColor}
              strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR}
              listening={false}
            />
          )

          rows.push(
            <Line
              key="divider-2"
              points={[
                col3Left + INFO_BLOCK_HEADER_LINE_INSET,
                divider2Y,
                col3Right - INFO_BLOCK_HEADER_LINE_INSET,
                divider2Y,
              ]}
              stroke={frameColor}
              strokeWidth={INFO_BLOCK_STROKE_WIDTH_SEPARATOR}
              listening={false}
            />
          )

          rows.push(
            interactive ? (
              <Group key="ean">
                <Rect
                  x={generalBoxX}
                  y={eanSectionTop}
                  width={INFO_BLOCK_BOX_WIDTHS.general}
                  height={sectionHeight}
                  fill="transparent"
                  listening={true}
                  onClick={(ev) => handleBoxClick(ev, 'ean')}
                  onTap={(ev) => handleBoxClick(ev, 'ean')}
                />
                {isSelected('ean') && (
                  <Rect
                    {...getEendraadSelectionRectProps(
                      canvasZoom,
                      generalBoxX,
                      eanSectionTop,
                      INFO_BLOCK_BOX_WIDTHS.general,
                      sectionHeight
                    )}
                  />
                )}
                <Text
                  x={generalBoxX + INFO_BLOCK_PADDING}
                  y={eanY}
                  text={eanDisplay}
                  fontSize={INFO_BLOCK_FONT_SIZE_BODY}
                  fontFamily={fontFamily}
                  fill={textColor}
                  listening={false}
                />
              </Group>
            ) : (
              <Text
                key="ean"
                x={generalBoxX + INFO_BLOCK_PADDING}
                y={eanY}
                text={eanDisplay}
                fontSize={INFO_BLOCK_FONT_SIZE_BODY}
                fontFamily={fontFamily}
                fill={textColor}
                listening={false}
              />
            )
          )

          return rows
        })()}
      </Group>
    </Group>
  )
})

export { INFO_BLOCK_TOTAL_WIDTH, INFO_BLOCK_HEIGHT } from '@/lib/infoBlockLayout'

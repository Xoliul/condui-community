/** Watermark and encoding shared by every page of a limited (locked-project) PDF export. */
export const LIMITED_RASTER_WATERMARK_OPACITY = 0.1
export const LIMITED_RASTER_JPEG_QUALITY = 0.62

let logoLoading: Promise<HTMLImageElement> | null = null

function loadLogo(): Promise<HTMLImageElement> {
  logoLoading ??= new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load watermark logo'))
    image.src = '/logos/Condui_logo.svg'
  })
  logoLoading.catch(() => {
    logoLoading = null
  })
  return logoLoading
}

type WatermarkContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Draws the faint, tilted Condui.BE mark across the middle of a rendered page. */
export async function drawLimitedWatermark(
  context: WatermarkContext,
  width: number,
  height: number,
  textColor: string
): Promise<void> {
  context.save()
  context.globalAlpha = LIMITED_RASTER_WATERMARK_OPACITY
  context.translate(width / 2, height / 2)
  context.rotate(-Math.PI / 8)

  try {
    const logo = await loadLogo()
    const targetWidth = width * 0.48
    const aspect = logo.naturalHeight > 0 ? logo.naturalWidth / logo.naturalHeight : 4
    const targetHeight = targetWidth / aspect
    const suffixFontSize = Math.round(targetHeight * 0.58)
    context.font = `800 ${suffixFontSize}px sans-serif`
    const suffix = '.BE'
    const suffixWidth = context.measureText(suffix).width
    const gap = targetHeight * 0.12
    const totalWidth = targetWidth + gap + suffixWidth
    const logoX = -totalWidth / 2
    context.drawImage(logo, logoX, -targetHeight / 2, targetWidth, targetHeight)
    context.fillStyle = textColor
    context.textAlign = 'left'
    context.textBaseline = 'middle'
    context.fillText(suffix, logoX + targetWidth + gap, 0)
  } catch {
    context.fillStyle = textColor
    context.font = `700 ${Math.round(width * 0.11)}px sans-serif`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText('Condui.BE', 0, 0)
  } finally {
    context.restore()
  }
}

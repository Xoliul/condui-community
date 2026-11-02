import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { computePlanImportFitScale } from './planImportViewport'
import { clamp } from '@/lib/geometry'
import { logger } from '@/lib/logger'
import { fitCanvasSize } from '@/utils/canvasSizeLimit'

interface ImageCropperProps {
  imageDataUrl: string
  onCropComplete: (croppedDataUrl: string, crop: { x: number; y: number; width: number; height: number }) => void
  onBack?: () => void
  invertPreview?: boolean
  surfaceClassName?: string
}

function ImageCropper({
  imageDataUrl,
  onCropComplete,
  onBack,
  invertPreview = false,
  surfaceClassName = 'bg-gray-50 dark:bg-gray-800',
}: ImageCropperProps) {
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [dragMode, setDragMode] = useState<'move' | 'resize-nw' | 'resize-ne' | 'resize-sw' | 'resize-se' | null>(null)
  const [cropBox, setCropBox] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [scale, setScale] = useState(0.1) // Start with a small non-zero value
  const [imageLoaded, setImageLoaded] = useState(false)

  // Load image and set up canvas
  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height })
      setImageLoaded(true)
      
      // Initialize crop box to full image
      setCropBox({
        x: 0,
        y: 0,
        width: img.width,
        height: img.height,
      })
    }
    img.src = imageDataUrl
  }, [imageDataUrl])

  // Calculate and update scale when container size changes
  useEffect(() => {
    if (!imageLoaded || !imageSize) return

    const updateScale = () => {
      const container = containerRef.current
      if (!container) {
        // Retry if container not ready
        setTimeout(updateScale, 100)
        return
      }

      const containerWidth = container.clientWidth
      const containerHeight = container.clientHeight
      
      // Wait for container to have dimensions
      if (containerWidth <= 0 || containerHeight <= 0) {
        setTimeout(updateScale, 100)
        return
      }
      
      const newScale = computePlanImportFitScale(imageSize, containerWidth, containerHeight)
      if (newScale != null) {
        setScale(newScale)
      }
    }

    // Use requestAnimationFrame to ensure DOM is ready
    requestAnimationFrame(() => {
      updateScale()
    })

    // Update on resize
    const resizeObserver = new ResizeObserver(() => {
      updateScale()
    })
    
    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [imageLoaded, imageSize])

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current || !imageSize || !imageLoaded || !cropBox) return
    
    // Don't draw if scale is not ready
    if (!scale || scale <= 0) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      logger.error('Failed to get canvas context')
      return
    }

    const img = new Image()
    img.crossOrigin = 'anonymous'
    
    img.onload = () => {
      try {
        // Add padding for handles
        const handlePadding = 20
        const displayWidth = Math.max(1, Math.floor(img.width * scale))
        const displayHeight = Math.max(1, Math.floor(img.height * scale))
        
        // Set canvas size with padding
        canvas.width = displayWidth + handlePadding * 2
        canvas.height = displayHeight + handlePadding * 2
        
        // Adjust crop coordinates to account for padding
        const imageOffsetX = handlePadding
        const imageOffsetY = handlePadding
        
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        
        // Draw image with offset
        ctx.save()
        if (invertPreview) {
          ctx.filter = 'invert(1)'
        }
        ctx.drawImage(img, imageOffsetX, imageOffsetY, displayWidth, displayHeight)
        ctx.restore()
        
        // Draw crop overlay (with offset)
        const cropX = cropBox.x * scale + imageOffsetX
        const cropY = cropBox.y * scale + imageOffsetY
        const cropW = cropBox.width * scale
        const cropH = cropBox.height * scale
        
        // Draw dark overlay only outside the crop area
        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)'
        
        // Top rectangle
        ctx.fillRect(0, 0, canvas.width, cropY)
        // Bottom rectangle
        ctx.fillRect(0, cropY + cropH, canvas.width, canvas.height - (cropY + cropH))
        // Left rectangle
        ctx.fillRect(0, cropY, cropX, cropH)
        // Right rectangle
        ctx.fillRect(cropX + cropW, cropY, canvas.width - (cropX + cropW), cropH)
        
        // Draw crop box border
        ctx.strokeStyle = '#0284c7'
        ctx.lineWidth = 3
        ctx.strokeRect(cropX, cropY, cropW, cropH)
        
        // Draw corner handles (larger and outside the crop area)
        const handleSize = 14
        ctx.fillStyle = '#0284c7'
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        const corners: Array<[number, number]> = [
          [cropX, cropY],
          [cropX + cropW, cropY],
          [cropX, cropY + cropH],
          [cropX + cropW, cropY + cropH],
        ]
        corners.forEach(([x, y]) => {
          ctx.beginPath()
          ctx.arc(x, y, handleSize / 2, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()
        })
      } catch (error) {
        logger.error('Error drawing canvas:', error)
      }
    }
    
    img.onerror = (error) => {
      logger.error('Failed to load image for cropping:', error)
    }
    
    img.src = imageDataUrl
  }, [imageDataUrl, imageSize, scale, cropBox, imageLoaded, invertPreview])

  // Get handle at position
  const getHandleAt = useCallback((x: number, y: number, cropBox: { x: number; y: number; width: number; height: number }, scale: number) => {
    const handleSize = 12 / scale
    const threshold = handleSize * 1.5 // Make it easier to grab
    
    const corners = [
      { x: cropBox.x, y: cropBox.y, type: 'resize-nw' as const },
      { x: cropBox.x + cropBox.width, y: cropBox.y, type: 'resize-ne' as const },
      { x: cropBox.x, y: cropBox.y + cropBox.height, type: 'resize-sw' as const },
      { x: cropBox.x + cropBox.width, y: cropBox.y + cropBox.height, type: 'resize-se' as const },
    ]
    
    for (const corner of corners) {
      const dx = Math.abs(x - corner.x)
      const dy = Math.abs(y - corner.y)
      if (dx < threshold && dy < threshold) {
        return corner.type
      }
    }
    
    // Check if inside crop box (for moving)
    if (
      x >= cropBox.x &&
      x <= cropBox.x + cropBox.width &&
      y >= cropBox.y &&
      y <= cropBox.y + cropBox.height
    ) {
      return 'move' as const
    }
    
    return null
  }, [])

  // Handle mouse down
  const eventToImageCoords = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    if (!rect || rect.width <= 0 || rect.height <= 0) return null
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const canvasX = (e.clientX - rect.left) * scaleX
    const canvasY = (e.clientY - rect.top) * scaleY
    const handlePadding = 20
    return {
      x: (canvasX - handlePadding) / scale,
      y: (canvasY - handlePadding) / scale,
    }
  }, [scale])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!cropBox || !imageSize) return
    const coords = eventToImageCoords(e)
    if (!coords) return
    const { x, y } = coords
    
    const mode = getHandleAt(x, y, cropBox, scale)
    if (mode) {
      setIsDragging(true)
      setDragMode(mode)
      setDragStart({ x, y })
    }
  }, [cropBox, scale, imageSize, getHandleAt, eventToImageCoords])

  // Handle mouse move
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !dragStart || !dragMode || !cropBox || !imageSize) return
    const coords = eventToImageCoords(e)
    if (!coords) return
    const { x, y } = coords
    
    const dx = x - dragStart.x
    const dy = y - dragStart.y
    
    if (dragMode === 'move') {
      // Move the entire crop box
      setCropBox({
        x: clamp(cropBox.x + dx, 0, imageSize.width - cropBox.width),
        y: clamp(cropBox.y + dy, 0, imageSize.height - cropBox.height),
        width: cropBox.width,
        height: cropBox.height,
      })
    } else {
      // Resize based on which corner
      let newX = cropBox.x
      let newY = cropBox.y
      let newWidth = cropBox.width
      let newHeight = cropBox.height
      
      if (dragMode === 'resize-nw') {
        newX = Math.max(0, cropBox.x + dx)
        newY = Math.max(0, cropBox.y + dy)
        newWidth = Math.min(cropBox.width - dx, imageSize.width - newX)
        newHeight = Math.min(cropBox.height - dy, imageSize.height - newY)
      } else if (dragMode === 'resize-ne') {
        newY = Math.max(0, cropBox.y + dy)
        newWidth = Math.min(cropBox.width + dx, imageSize.width - cropBox.x)
        newHeight = Math.min(cropBox.height - dy, imageSize.height - newY)
      } else if (dragMode === 'resize-sw') {
        newX = Math.max(0, cropBox.x + dx)
        newWidth = Math.min(cropBox.width - dx, imageSize.width - newX)
        newHeight = Math.min(cropBox.height + dy, imageSize.height - cropBox.y)
      } else if (dragMode === 'resize-se') {
        newWidth = Math.min(cropBox.width + dx, imageSize.width - cropBox.x)
        newHeight = Math.min(cropBox.height + dy, imageSize.height - cropBox.y)
      }
      
      // Ensure minimum size
      if (newWidth > 10 && newHeight > 10) {
        setCropBox({
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight,
        })
      }
    }
    
    setDragStart({ x, y })
  }, [isDragging, dragStart, dragMode, cropBox, imageSize, eventToImageCoords])

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
    setDragStart(null)
    setDragMode(null)
  }, [])

  // Handle crop
  const handleCrop = useCallback(() => {
    if (!cropBox || !imageSize) return
    
    const img = new Image()
    img.onload = () => {
      // Very large scans are downscaled so the browser can allocate the output canvas.
      const output = fitCanvasSize(cropBox.width, cropBox.height)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = output.width
        canvas.height = output.height
        const ctx = canvas.getContext('2d')
        if (!ctx) return

        ctx.drawImage(
          img,
          cropBox.x,
          cropBox.y,
          cropBox.width,
          cropBox.height,
          0,
          0,
          output.width,
          output.height
        )

        const croppedDataUrl = canvas.toDataURL('image/png')
        onCropComplete(croppedDataUrl, cropBox)
      } catch (error) {
        logger.error('Failed to crop plan image:', error)
      }
    }
    img.src = imageDataUrl
  }, [cropBox, imageSize, imageDataUrl, onCropComplete])

  if (!imageLoaded || !imageSize) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500 dark:text-gray-400">{t('planImport.loading')}</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <p className="flex-shrink-0 text-sm text-gray-600 dark:text-gray-400">
        {t('planImport.cropDescription')}
      </p>

      <div
        ref={containerRef}
        className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-gray-300 dark:border-gray-600 ${surfaceClassName}`}
      >
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          {scale > 0 && imageLoaded && cropBox ? (
            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              className={`max-h-full max-w-full object-contain ${
                dragMode === 'move'
                  ? 'cursor-move'
                  : dragMode?.startsWith('resize')
                    ? 'cursor-nwse-resize'
                    : 'cursor-move'
              }`}
            />
          ) : (
            <div className="text-gray-500 dark:text-gray-400">
              {t('planImport.loading')}... {scale > 0 ? `(scale: ${scale.toFixed(3)})` : ''}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-col gap-3">
        <button
          type="button"
          onClick={() => {
            // Reset to full image
            setCropBox({
              x: 0,
              y: 0,
              width: imageSize.width,
              height: imageSize.height,
            })
          }}
          className="px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          {t('planImport.resetCrop')}
        </button>
        <div className={`${onBack ? 'grid grid-cols-2' : 'flex justify-end'} items-center gap-3`}>
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="w-full px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              {t('common.back')}
            </button>
          )}
          <button
            type="button"
            data-testid="e2e-import-plan-apply-crop"
            onClick={handleCrop}
            className="w-full px-6 py-3 bg-sky-600 hover:bg-sky-700 text-white font-semibold rounded-md shadow-md transition-colors"
          >
            {t('planImport.applyCrop')}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ImageCropper

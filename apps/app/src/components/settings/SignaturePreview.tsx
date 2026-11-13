import { useSignatureImage } from '@/hooks/useSignatureImage'
import { useSettingsStore } from '@/stores/settingsStore'

export function SignaturePreview({ source, className }: { source: string; className?: string }) {
  const isDark = useSettingsStore((state) => state.theme.mode === 'dark')
  const image = useSignatureImage(source, isDark)
  return image ? <img src={image.src} alt="" aria-hidden className={className} /> : null
}

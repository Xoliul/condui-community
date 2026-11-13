import { useEffect, useState } from 'react'
import { prepareSignatureImage } from '@/lib/image/signatureImage'

export function useSignatureImage(source: string | null | undefined, isDark: boolean) {
  const [loaded, setLoaded] = useState<{
    source: string; isDark: boolean; image: HTMLImageElement
  } | null>(null)
  useEffect(() => {
    let cancelled = false
    if (source) {
      void prepareSignatureImage(source, isDark).then((image) => {
        if (!cancelled) setLoaded({ source, isDark, image })
      }).catch(() => { /* Invalid images stay hidden. */ })
    }
    return () => { cancelled = true }
  }, [source, isDark])
  return loaded?.source === source && loaded?.isDark === isDark ? loaded.image : null
}

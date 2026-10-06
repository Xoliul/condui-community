import { useEffect, useState } from 'react'
import { getDecodedInfoBlockLogo, loadInfoBlockLogo } from '@/lib/infoBlockLogoImage'

/** The decoded installer logo, or null while loading, when absent, or when it cannot decode. */
export function useInfoBlockLogoImage(url: string | null | undefined): HTMLImageElement | null {
  const [state, setState] = useState(() => ({ url, image: getDecodedInfoBlockLogo(url) ?? null }))

  useEffect(() => {
    let cancelled = false
    const known = getDecodedInfoBlockLogo(url)
    if (known !== undefined) {
      setState({ url, image: known })
      return
    }
    setState({ url, image: null })
    void loadInfoBlockLogo(url).then((image) => {
      if (!cancelled) setState({ url, image })
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return state.url === url ? state.image : (getDecodedInfoBlockLogo(url) ?? null)
}

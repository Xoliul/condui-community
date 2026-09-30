import { Star } from 'lucide-react'

/** The amber star used for hosted features unavailable to this project. */
export function HostedFeatureBadge({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300 ${className}`}
      aria-hidden
    >
      <Star className="h-3 w-3" fill="currentColor" />
    </span>
  )
}

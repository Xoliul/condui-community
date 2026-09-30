/**
 * Cable routes, plan-estimated lengths, the cable schedule, and cable wires on the plan. Built into
 * hosted and community builds alike; on in development and E2E builds, elsewhere opt-in with
 * `VITE_ENABLE_CABLE_ROUTES=1` (or off anywhere with `0`). Independent of the Structural canvas,
 * which stays out of the community UI.
 */
export function isCableRoutesEnabled(): boolean {
  const flag = import.meta.env.VITE_ENABLE_CABLE_ROUTES?.trim().toLowerCase()
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return true
  return import.meta.env.DEV || import.meta.env.VITE_E2E === '1'
}

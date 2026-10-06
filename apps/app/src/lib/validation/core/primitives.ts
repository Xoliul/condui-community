/**
 * Registry of reusable check functions (primitives) that rules can reference.
 *
 * Primitive implementations live in domain modules under ./primitives and
 * register themselves as side effects when this public entrypoint is imported.
 */
export { registerPrimitive, getPrimitive } from './primitives/registry'

import './primitives/generic'
import './primitives/cable'
import './primitives/protection'
import './primitives/shortCircuit'
import './primitives/circuit'
import './primitives/circuit-rcd'
import './primitives/circuit-sequence'
import './primitives/controlLink'
import './primitives/panel'
import './primitives/earthing'
import './primitives/sitplan'
import './primitives/supply'

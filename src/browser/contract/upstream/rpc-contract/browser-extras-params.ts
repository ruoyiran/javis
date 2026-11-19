import { z } from 'zod'
import { MouseButton, MouseXY } from './browser-params.js'
import { OptionalFiniteNumber } from './rpc-param-primitives.js'

export const MouseModifiers = z
  .unknown()
  .transform((v) => (Array.isArray(v) ? v : undefined))
  .pipe(z.union([z.array(z.enum(['cmd', 'ctrl', 'alt', 'shift'])), z.undefined()]))
  .optional()

export const MouseClick = MouseXY.merge(MouseButton).extend({
  radius: OptionalFiniteNumber,
  modifiers: MouseModifiers
})

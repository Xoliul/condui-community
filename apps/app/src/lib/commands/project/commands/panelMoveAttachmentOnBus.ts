import { z } from 'zod'
import {
  movePanelAttachmentOnRcdBus,
  movePanelAttachmentOnSecondaryBus,
  movePanelAttachmentToMainBus,
} from '@/lib/eendraad/panelAttachmentMove'
import { findPanelById } from '@/lib/panel/panelTree'
import { getEditableProjectElectricalPanels } from '@/lib/projectV2/electrical'
import { CommandError, defineProjectCommand } from '../types'

export const panelMoveAttachmentOnBusInputSchema = z.strictObject({
  panelId: z.string().min(1),
  target: z.discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('secondaryBus'),
      parentCircuitId: z.string().min(1),
      insertIndex: z.number().int().nonnegative(),
    }),
    z.strictObject({
      type: z.literal('rcdBus'),
      protectionId: z.string().min(1),
      insertIndex: z.number().int().nonnegative(),
    }),
    z.strictObject({
      type: z.literal('mainBus'),
      sourcePanelId: z.string().min(1),
      insertIndex: z.number().int().nonnegative(),
    }),
  ]),
})

export type PanelMoveAttachmentOnBusInput = z.input<typeof panelMoveAttachmentOnBusInputSchema>

/** Moves a distribution board's feed attachment onto a secondary, RCD or main bus position. */
export const panelMoveAttachmentOnBus = defineProjectCommand({
  id: 'panel.moveAttachmentOnBus',
  version: 1,
  input: panelMoveAttachmentOnBusInputSchema,
  check(project, input) {
    return findPanelById(getEditableProjectElectricalPanels(project), input.panelId)
      ? { ok: true }
      : { ok: false, code: 'unknown_panel', message: 'Panel no longer exists.' }
  },
  apply(draft, input) {
    const panels = getEditableProjectElectricalPanels(draft)
    const { target } = input
    const result =
      target.type === 'secondaryBus'
        ? movePanelAttachmentOnSecondaryBus(
            panels,
            input.panelId,
            target.parentCircuitId,
            target.insertIndex
          )
        : target.type === 'rcdBus'
          ? movePanelAttachmentOnRcdBus(panels, input.panelId, target.protectionId, target.insertIndex)
          : movePanelAttachmentToMainBus(
              panels,
              input.panelId,
              target.sourcePanelId,
              target.insertIndex
            )
    if (!result)
      throw new CommandError('check_failed', 'Panel attachment cannot be moved to this bus position', {
        reason: 'panel_attachment_move_rejected',
      })
    return {
      created: [],
      changed: [{ kind: 'panel' as const, id: input.panelId }],
      removed: [],
      select: [{ kind: 'panel' as const, id: input.panelId }],
    }
  },
})

/**
 * Scoped lookup of resolved control-link note text for the one-wire layout pass.
 *
 * Layout measurement, envelope packing and rendering all read endpoint notes through
 * `getVisibleEndpointNoteText`. A linked endpoint shows `<device> · <channel>` instead of
 * its own notes, which needs project context the pure endpoint readers do not have. The
 * layout entry point opens this scope once per synchronous pass so every reader inside it
 * resolves the identical text.
 */
let activeNotes: ReadonlyMap<string, string> | undefined

export function getScopedControlLinkNote(endpointId: string): string | undefined {
  return activeNotes?.get(endpointId)
}

export function runWithControlLinkNotes<T>(
  notes: ReadonlyMap<string, string>,
  run: () => T
): T {
  const previous = activeNotes
  activeNotes = notes
  try {
    return run()
  } finally {
    activeNotes = previous
  }
}

/** Map key of the address shown after a wired domotica output row's label. */
export function rowAddressKey(endpointId: string): string {
  return `row-address:${endpointId}`
}

/**
 * Address (channel) of the output row a wired domotica child sits on, for the layout scope.
 * Shared by measurement, envelopes and the label node so every reader sees the same text.
 */
export function getScopedRowAddress(endpointId: string): string | undefined {
  return activeNotes?.get(rowAddressKey(endpointId))
}

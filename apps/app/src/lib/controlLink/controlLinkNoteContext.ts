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

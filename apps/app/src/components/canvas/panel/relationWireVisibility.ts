export function shouldSuppressPanelRelationWires(
  isMarqueeSelecting: boolean,
  selectedItemCount: number
): boolean {
  return isMarqueeSelecting || selectedItemCount > 1
}

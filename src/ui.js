export function anchoredMenuPosition(rect, viewportWidth, viewportHeight) {
  const edgeGap = 12;
  const menuGap = 6;
  const availableBelow = viewportHeight - rect.bottom - edgeGap;
  const availableAbove = rect.top - edgeGap;
  const maxHeight = Math.min(260, Math.max(120, Math.max(availableBelow, availableAbove)));
  const opensAbove = availableBelow < 160 && availableAbove > availableBelow;

  return {
    left: Math.max(edgeGap, Math.min(rect.left, viewportWidth - rect.width - edgeGap)),
    top: opensAbove ? Math.max(edgeGap, rect.top - maxHeight - menuGap) : rect.bottom + menuGap,
    width: rect.width,
    maxHeight,
  };
}

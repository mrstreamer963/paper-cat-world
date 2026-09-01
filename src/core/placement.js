export function placementAnchor(entity, transform = entity?.transform) {
  if (!entity || !transform) return { x: transform?.x, y: transform?.y };
  if (entity.kind !== "sheet" || entity.state !== "closed") return { x: transform.x, y: transform.y };
  const foldedOffset = entity.width * transform.scale / 2;
  return {
    x: transform.x + Math.cos(transform.rotation) * foldedOffset,
    y: transform.y + Math.sin(transform.rotation) * foldedOffset,
  };
}

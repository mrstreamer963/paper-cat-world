export function signedPolygonArea(points) {
  if (!Array.isArray(points) || points.length < 3) return 0;
  let doubledArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    doubledArea += current.x * next.y - next.x * current.y;
  }
  return doubledArea / 2;
}

export function isFinitePoint(point) {
  return point !== null && typeof point === "object"
    && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function orientation(a, b, c, epsilon) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(cross) <= epsilon ? 0 : Math.sign(cross);
}

function pointOnSegment(point, start, end, epsilon) {
  return orientation(start, end, point, epsilon) === 0
    && point.x >= Math.min(start.x, end.x) - epsilon
    && point.x <= Math.max(start.x, end.x) + epsilon
    && point.y >= Math.min(start.y, end.y) - epsilon
    && point.y <= Math.max(start.y, end.y) + epsilon;
}

export function segmentsIntersect(a, b, c, d, epsilon = 1e-9) {
  const abC = orientation(a, b, c, epsilon);
  const abD = orientation(a, b, d, epsilon);
  const cdA = orientation(c, d, a, epsilon);
  const cdB = orientation(c, d, b, epsilon);
  if (abC !== abD && cdA !== cdB) return true;
  return (abC === 0 && pointOnSegment(c, a, b, epsilon))
    || (abD === 0 && pointOnSegment(d, a, b, epsilon))
    || (cdA === 0 && pointOnSegment(a, c, d, epsilon))
    || (cdB === 0 && pointOnSegment(b, c, d, epsilon));
}

export const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pointsAabb(points, padding = 0) {
  if (!Array.isArray(points) || points.length === 0 || points.some((p) => !isFinitePoint(p))) return null;
  return {
    minX: Math.min(...points.map((p) => p.x)) - padding,
    minY: Math.min(...points.map((p) => p.y)) - padding,
    maxX: Math.max(...points.map((p) => p.x)) + padding,
    maxY: Math.max(...points.map((p) => p.y)) + padding,
  };
}

export function aabbIntersects(a, b) {
  return Boolean(a && b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY);
}

export function polygonCentroid(points, epsilon = 1e-9) {
  const area = signedPolygonArea(points);
  if (!Number.isFinite(area) || Math.abs(area) <= epsilon) return null;
  let x = 0, y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i], b = points[(i + 1) % points.length], cross = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * cross; y += (a.y + b.y) * cross;
  }
  return { x: x / (6 * area), y: y / (6 * area) };
}

export function normalizeClosedContour(points, closeDistance, epsilon = 1e-9) {
  if (!Array.isArray(points) || points.some((p) => !isFinitePoint(p))) return { ok: false, code: "INVALID_CONTOUR" };
  const clean = points.map(({ x, y }) => ({ x, y })).filter((p, i, list) => i === 0 || pointDistance(p, list[i - 1]) > epsilon);
  if (clean.length < 2 || pointDistance(clean[0], clean[clean.length - 1]) > closeDistance) return { ok: false, code: "CONTOUR_NOT_CLOSED" };
  clean[clean.length - 1] = { ...clean[0] };
  clean.pop();
  if (new Set(clean.map((p) => `${p.x},${p.y}`)).size < 3) return { ok: false, code: "INVALID_CONTOUR" };
  if (!isSimplePolygon(clean, epsilon)) return { ok: false, code: "CONTOUR_SELF_INTERSECTS" };
  return { ok: true, contour: clean };
}

export function isSimplePolygon(points, epsilon = 1e-9) {
  if (!Array.isArray(points) || points.length < 3 || points.some((point) => !isFinitePoint(point))) return false;
  if (Math.abs(signedPolygonArea(points)) <= epsilon) return false;
  const count = points.length;
  for (let first = 0; first < count; first += 1) {
    const firstNext = (first + 1) % count;
    if (pointOnSegment(points[first], points[firstNext], points[firstNext], epsilon)) {
      if (Math.hypot(points[first].x - points[firstNext].x, points[first].y - points[firstNext].y) <= epsilon) return false;
    }
    for (let second = first + 1; second < count; second += 1) {
      const secondNext = (second + 1) % count;
      if (first === second || firstNext === second || secondNext === first) continue;
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext], epsilon)) return false;
    }
  }
  return true;
}

export function pointInPolygon(point, points, epsilon = 1e-9) {
  if (!isFinitePoint(point) || !Array.isArray(points) || points.length < 3) return false;
  let inside = false;
  for (let current = 0, previous = points.length - 1; current < points.length; previous = current, current += 1) {
    const a = points[previous];
    const b = points[current];
    if (pointOnSegment(point, a, b, epsilon)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

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
  return (
    point !== null &&
    typeof point === "object" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function orientation(a, b, c, epsilon) {
  const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return Math.abs(cross) <= epsilon ? 0 : Math.sign(cross);
}

function pointOnSegment(point, start, end, epsilon) {
  return (
    orientation(start, end, point, epsilon) === 0 &&
    point.x >= Math.min(start.x, end.x) - epsilon &&
    point.x <= Math.max(start.x, end.x) + epsilon &&
    point.y >= Math.min(start.y, end.y) - epsilon &&
    point.y <= Math.max(start.y, end.y) + epsilon
  );
}

export function segmentsIntersect(a, b, c, d, epsilon = 1e-9) {
  const abC = orientation(a, b, c, epsilon);
  const abD = orientation(a, b, d, epsilon);
  const cdA = orientation(c, d, a, epsilon);
  const cdB = orientation(c, d, b, epsilon);
  if (abC !== abD && cdA !== cdB) return true;
  return (
    (abC === 0 && pointOnSegment(c, a, b, epsilon)) ||
    (abD === 0 && pointOnSegment(d, a, b, epsilon)) ||
    (cdA === 0 && pointOnSegment(a, c, d, epsilon)) ||
    (cdB === 0 && pointOnSegment(b, c, d, epsilon))
  );
}

export const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function pointsAabb(points, padding = 0) {
  if (
    !Array.isArray(points) ||
    points.length === 0 ||
    points.some((p) => !isFinitePoint(p))
  )
    return null;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    minX: minX - padding,
    minY: minY - padding,
    maxX: maxX + padding,
    maxY: maxY + padding,
  };
}

export function aabbIntersects(a, b) {
  return Boolean(
    a &&
      b &&
      a.minX <= b.maxX &&
      a.maxX >= b.minX &&
      a.minY <= b.maxY &&
      a.maxY >= b.minY,
  );
}

export function polygonCentroid(points, epsilon = 1e-9) {
  const area = signedPolygonArea(points);
  if (!Number.isFinite(area) || Math.abs(area) <= epsilon) return null;
  let x = 0,
    y = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i],
      b = points[(i + 1) % points.length],
      cross = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  return { x: x / (6 * area), y: y / (6 * area) };
}

export function normalizeClosedContour(points, closeDistance, epsilon = 1e-9) {
  if (!Array.isArray(points) || points.some((p) => !isFinitePoint(p)))
    return { ok: false, code: "INVALID_CONTOUR" };
  const clean = points
    .map(({ x, y }) => ({ x, y }))
    .filter((p, i, list) => i === 0 || pointDistance(p, list[i - 1]) > epsilon);
  if (
    clean.length < 2 ||
    pointDistance(clean[0], clean[clean.length - 1]) > closeDistance
  )
    return { ok: false, code: "CONTOUR_NOT_CLOSED" };
  clean[clean.length - 1] = { ...clean[0] };
  clean.pop();
  if (new Set(clean.map((p) => `${p.x},${p.y}`)).size < 3)
    return { ok: false, code: "INVALID_CONTOUR" };
  if (!isSimplePolygon(clean, epsilon))
    return { ok: false, code: "CONTOUR_SELF_INTERSECTS" };
  return { ok: true, contour: clean };
}

export function isSimplePolygon(points, epsilon = 1e-9) {
  if (
    !Array.isArray(points) ||
    points.length < 3 ||
    points.some((point) => !isFinitePoint(point))
  )
    return false;
  if (Math.abs(signedPolygonArea(points)) <= epsilon) return false;
  const count = points.length;
  for (let first = 0; first < count; first += 1) {
    const firstNext = (first + 1) % count;
    if (pointDistance(points[first], points[firstNext]) <= epsilon)
      return false;
    for (let second = first + 1; second < count; second += 1) {
      const secondNext = (second + 1) % count;
      if (first === second || firstNext === second || secondNext === first)
        continue;
      if (
        segmentsIntersect(
          points[first],
          points[firstNext],
          points[second],
          points[secondNext],
          epsilon,
        )
      )
        return false;
    }
  }
  return true;
}

export function isConvexPolygon(points, epsilon = 1e-9) {
  if (!isSimplePolygon(points, epsilon)) return false;
  let direction = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index],
      b = points[(index + 1) % points.length],
      c = points[(index + 2) % points.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) <= epsilon) continue;
    if (direction && Math.sign(cross) !== direction) return false;
    direction = Math.sign(cross);
  }
  return direction !== 0;
}

export function triangulateSimplePolygon(points, epsilon = 1e-9) {
  if (!isSimplePolygon(points, epsilon)) return [];
  const orientationSign = Math.sign(signedPolygonArea(points)),
    indices = points.map((_, index) => index),
    triangles = [];
  const cross = (a, b, c) =>
    ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) * orientationSign;
  let guard = points.length * points.length;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let index = 0; index < indices.length; index += 1) {
      const previous = indices[(index + indices.length - 1) % indices.length],
        current = indices[index],
        next = indices[(index + 1) % indices.length];
      const triangle = [points[previous], points[current], points[next]];
      if (cross(...triangle) <= epsilon) continue;
      if (
        indices.some(
          (candidate) =>
            candidate !== previous &&
            candidate !== current &&
            candidate !== next &&
            pointInPolygon(points[candidate], triangle, epsilon),
        )
      )
        continue;
      triangles.push(triangle.map((point) => ({ ...point })));
      indices.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) return [];
  }
  if (indices.length === 3)
    triangles.push(indices.map((index) => ({ ...points[index] })));
  return triangles;
}

export function pointInPolygon(point, points, epsilon = 1e-9) {
  if (!isFinitePoint(point) || !Array.isArray(points) || points.length < 3)
    return false;
  let inside = false;
  for (
    let current = 0, previous = points.length - 1;
    current < points.length;
    previous = current, current += 1
  ) {
    const a = points[previous];
    const b = points[current];
    if (pointOnSegment(point, a, b, epsilon)) return true;
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

// Clips an arbitrary simple subject polygon against a convex polygon.
export function clipPolygonToConvex(subject, clip, epsilon = 1e-9) {
  if (!isSimplePolygon(subject, epsilon) || !isSimplePolygon(clip, epsilon))
    return [];
  const direction = Math.sign(signedPolygonArea(clip));
  let output = subject.map((point) => ({ ...point }));
  const cross = (a, b, p) =>
    ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) * direction;
  for (let i = 0; i < clip.length && output.length; i += 1) {
    const a = clip[i],
      b = clip[(i + 1) % clip.length],
      input = output;
    output = [];
    const intersection = (p, q) => {
      const ex = b.x - a.x,
        ey = b.y - a.y,
        dx = q.x - p.x,
        dy = q.y - p.y;
      const denominator = dx * ey - dy * ex;
      if (Math.abs(denominator) <= epsilon) return { ...q };
      const t = ((a.x - p.x) * ey - (a.y - p.y) * ex) / denominator;
      return { x: p.x + t * dx, y: p.y + t * dy };
    };
    for (let j = 0; j < input.length; j += 1) {
      const current = input[j],
        previous = input[(j + input.length - 1) % input.length];
      const currentInside = cross(a, b, current) >= -epsilon,
        previousInside = cross(a, b, previous) >= -epsilon;
      if (currentInside !== previousInside)
        output.push(intersection(previous, current));
      if (currentInside) output.push(current);
    }
  }
  return output;
}

export function polygonIntersectionArea(subject, convexClip, epsilon = 1e-9) {
  if (!isConvexPolygon(convexClip, epsilon)) return 0;
  return triangulateSimplePolygon(subject, epsilon).reduce(
    (area, triangle) =>
      area +
      Math.abs(
        signedPolygonArea(clipPolygonToConvex(triangle, convexClip, epsilon)),
      ),
    0,
  );
}

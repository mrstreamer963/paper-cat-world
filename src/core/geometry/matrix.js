export const identityMatrix = () => [1, 0, 0, 1, 0, 0];

export function matrixFromTransform({ x, y, rotation, scale }) {
  const cosine = Math.cos(rotation) * scale;
  const sine = Math.sin(rotation) * scale;
  return [cosine, sine, -sine, cosine, x, y];
}

export function multiplyMatrices(left, right) {
  const [a, b, c, d, e, f] = left;
  const [g, h, i, j, k, l] = right;
  return [
    a * g + c * h,
    b * g + d * h,
    a * i + c * j,
    b * i + d * j,
    a * k + c * l + e,
    b * k + d * l + f,
  ];
}

export function invertMatrix(matrix, epsilon = 1e-9) {
  const [a, b, c, d, e, f] = matrix;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) <= epsilon) {
    return null;
  }
  return [
    d / determinant,
    -b / determinant,
    -c / determinant,
    a / determinant,
    (c * f - d * e) / determinant,
    (b * e - a * f) / determinant,
  ];
}

export function transformPoint(matrix, point) {
  return {
    x: matrix[0] * point.x + matrix[2] * point.y + matrix[4],
    y: matrix[1] * point.x + matrix[3] * point.y + matrix[5],
  };
}

export function decomposeMatrix(matrix, epsilon = 1e-9) {
  if (!Array.isArray(matrix) || matrix.length !== 6 || matrix.some((value) => !Number.isFinite(value))) {
    return null;
  }
  const [a, b, c, d, x, y] = matrix;
  const scale = Math.hypot(a, b);
  if (scale <= epsilon || a * d - b * c <= 0) return null;
  const tolerance = epsilon * Math.max(1, scale);
  if (Math.abs(Math.hypot(c, d) - scale) > tolerance) return null;
  if (Math.abs(a * c + b * d) > tolerance * scale) return null;

  const rotation = Math.atan2(b, a);
  const expected = matrixFromTransform({ x, y, rotation, scale });
  if (expected.some((value, index) => Math.abs(value - matrix[index]) > tolerance)) return null;
  return { x, y, rotation, scale };
}

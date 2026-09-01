import { describe, expect, it } from "vitest";
import { decomposeMatrix, identityMatrix, invertMatrix, isSimplePolygon, matrixFromTransform, multiplyMatrices, pointInPolygon, signedPolygonArea, transformPoint } from "../../src/core/index.js";

describe("affine geometry", () => {
  it("composes and inverts transforms", () => {
    const matrix = multiplyMatrices(matrixFromTransform({ x: 10, y: -4, rotation: 0.7, scale: 2 }), matrixFromTransform({ x: 3, y: 8, rotation: -0.2, scale: 0.5 }));
    const inverse = invertMatrix(matrix);
    const point = { x: 12, y: -7 };
    expect(transformPoint(inverse, transformPoint(matrix, point))).toEqual(expect.objectContaining({ x: expect.closeTo(point.x, 10), y: expect.closeTo(point.y, 10) }));
    expect(multiplyMatrices(identityMatrix(), matrix)).toEqual(matrix);
    expect(decomposeMatrix(matrix)).toEqual(expect.objectContaining({ scale: expect.closeTo(1, 10), rotation: expect.closeTo(0.5, 10) }));
  });

  it("rejects singular, reflected and non-uniform matrices", () => {
    expect(invertMatrix([0, 0, 0, 0, 0, 0])).toBeNull();
    expect(decomposeMatrix([1, 0, 0, -1, 0, 0])).toBeNull();
    expect(decomposeMatrix([2, 0, 0, 1, 0, 0])).toBeNull();
  });

  it("normalizes floating-point unit scale to exactly one", () => {
    const almostOne = 0.9999999999999999;
    expect(decomposeMatrix([almostOne, 0, 0, almostOne, 12, 34])).toEqual({ x: 12, y: 34, rotation: 0, scale: 1 });
  });
});

describe("polygon geometry", () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  it("calculates area and includes the boundary", () => {
    expect(signedPolygonArea(square)).toBe(100);
    expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 5 }, square)).toBe(true);
    expect(pointInPolygon({ x: 12, y: 5 }, square)).toBe(false);
  });
  it("rejects degenerate and self-intersecting polygons", () => {
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }])).toBe(false);
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }])).toBe(false);
  });
});

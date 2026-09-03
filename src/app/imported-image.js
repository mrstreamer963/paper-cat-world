const SVG_ELEMENTS = new Set([
  "svg",
  "g",
  "defs",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "use",
]);

const SVG_ATTRIBUTES = new Set([
  "xmlns",
  "viewBox",
  "width",
  "height",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "d",
  "points",
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "transform",
  "gradientUnits",
  "gradientTransform",
  "offset",
  "stop-color",
  "stop-opacity",
  "id",
  "clip-path",
  "mask",
  "href",
  "style",
]);

const STYLE_PROPERTIES = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-dasharray",
  "stroke-opacity",
  "opacity",
  "stop-color",
  "stop-opacity",
]);

const safePaintValue = (value) =>
  !/(?:javascript:|data:|https?:|@import)/i.test(value) &&
  (!/url\s*\(/i.test(value) || /^url\(\s*#[\w:.-]+\s*\)$/i.test(value));

function sanitizeStyle(value) {
  return value
    .split(";")
    .map((declaration) => declaration.split(":"))
    .filter(([property, ...parts]) => {
      const normalized = property?.trim().toLowerCase();
      return STYLE_PROPERTIES.has(normalized) && safePaintValue(parts.join(":"));
    })
    .map(([property, ...parts]) => `${property.trim()}:${parts.join(":").trim()}`)
    .join(";");
}

function numericDimension(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function sanitizeSvg(source) {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined")
    throw new Error("SVG parsing is unavailable");
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  if (document.querySelector("parsererror") || document.documentElement.localName !== "svg")
    throw new Error("Invalid SVG");
  const root = document.documentElement;
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (!SVG_ELEMENTS.has(element.localName)) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      const name = attribute.name;
      const value = attribute.value.trim();
      const allowedHref = name === "href" && /^#[\w:.-]+$/.test(value);
      if (
        name.toLowerCase().startsWith("on") ||
        !SVG_ATTRIBUTES.has(name) ||
        (name === "href" && !allowedHref) ||
        (name !== "href" && !safePaintValue(value))
      ) {
        element.removeAttribute(name);
      } else if (name === "style") {
        const style = sanitizeStyle(value);
        if (style) element.setAttribute("style", style);
        else element.removeAttribute("style");
      }
    }
  }
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const viewBox = root
      .getAttribute("viewBox")
      ?.trim()
      .split(/[ ,]+/)
      .map(Number),
    width =
      viewBox?.length === 4 && Number.isFinite(viewBox[2]) && viewBox[2] > 0
        ? viewBox[2]
        : numericDimension(root.getAttribute("width")) ?? 512,
    height =
      viewBox?.length === 4 && Number.isFinite(viewBox[3]) && viewBox[3] > 0
        ? viewBox[3]
        : numericDimension(root.getAttribute("height")) ?? 512;
  if (!root.hasAttribute("viewBox")) root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return { source: new XMLSerializer().serializeToString(root), width, height };
}

export function textToBase64DataUrl(text, mimeType) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function base64DataUrlText(source) {
  const payload = source.slice(source.indexOf(",") + 1),
    binary = atob(payload),
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function sanitizeWorldDrawingImages(world) {
  let changed = false;
  const isSvg = (source) => /^data:image\/svg\+xml;base64,/i.test(source);
  const drawings = Object.fromEntries(
    Object.entries(world.drawings).map(([id, drawing]) => {
      if (!(drawing.images ?? []).some((image) => isSvg(image.source)))
        return [id, drawing];
      const images = drawing.images.map((image) => {
        if (!isSvg(image.source)) return image;
        const cleaned = sanitizeSvg(base64DataUrlText(image.source)),
          source = textToBase64DataUrl(cleaned.source, "image/svg+xml");
        changed ||=
          source !== image.source ||
          cleaned.width !== image.width ||
          cleaned.height !== image.height;
        return { ...image, source, width: cleaned.width, height: cleaned.height };
      });
      return [id, { ...drawing, images }];
    }),
  );
  return changed ? { ...world, drawings } : world;
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error ?? new Error("File read failed"));
    reader.readAsDataURL(file);
  });
}

export function loadImageDimensions(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Image decode failed"));
    image.src = source;
  });
}

export async function importDrawingImage(file) {
  if (!file || file.size > 2 * 1024 * 1024) {
    const error = new Error("Image is too large");
    error.code = "FILE_TOO_LARGE";
    throw error;
  }
  const svg = file.type === "image/svg+xml" || /\.svg$/i.test(file.name);
  const png = file.type === "image/png" || /\.png$/i.test(file.name);
  if (!svg && !png) {
    const error = new Error("Unsupported image format");
    error.code = "UNSUPPORTED_IMAGE_FORMAT";
    throw error;
  }
  if (svg) {
    const cleaned = sanitizeSvg(await file.text());
    return {
      source: textToBase64DataUrl(cleaned.source, "image/svg+xml"),
      width: cleaned.width,
      height: cleaned.height,
    };
  }
  const rawSource = await fileToDataUrl(file),
    source = rawSource.replace(/^data:[^;,]*;base64,/i, "data:image/png;base64,"),
    dimensions = await loadImageDimensions(source);
  return { source, ...dimensions };
}

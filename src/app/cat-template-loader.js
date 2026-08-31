const parsePoints = (value) => value.trim().split(/\s+/).map((pair) => { const [x, y] = pair.split(",").map(Number); return { x, y }; });

export async function loadCatTemplates() {
  const response = await fetch(templateUrl);
  if (!response.ok) throw new Error("Unable to load cat template");
  const document = new DOMParser().parseFromString(await response.text(), "text/html");
  const svg = document.querySelector("svg"), [x, y, width, height] = (svg.getAttribute("viewBox") ?? svg.getAttribute("viewbox")).split(/\s+/).map(Number);
  const templateId = svg.getAttribute("data-template-id"), zones = {};
  for (const node of svg.querySelectorAll("polygon[data-zone]")) {
    const zoneId = node.getAttribute("data-zone");
    zones[zoneId] ??= { zoneId, layer: Number(node.getAttribute("data-layer")), tiePriority: Number(node.getAttribute("data-tie-priority")), polygons: [] };
    zones[zoneId].polygons.push(parsePoints(node.getAttribute("points")));
  }
  return { [templateId]: { templateId, viewBox: { x, y, width, height }, silhouette: parsePoints(svg.querySelector("polygon[data-silhouette]").getAttribute("points")), zones } };
}
import templateUrl from "../assets/cat-template.svg?url";

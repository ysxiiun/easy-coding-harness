import { GENERATED_REGION_END, GENERATED_REGION_START } from "../constants/paths.js";

export class MarkedRegionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkedRegionError";
  }
}

export function extractMarkedRegion(content: string): string | null {
  const start = content.indexOf(GENERATED_REGION_START);
  const end = content.indexOf(GENERATED_REGION_END);

  if (start === -1 && end === -1) {
    return null;
  }
  if (start === -1 || end === -1 || end < start) {
    throw new MarkedRegionError("Generated region markers are incomplete or out of order.");
  }

  return content.slice(start, end + GENERATED_REGION_END.length);
}

export function replaceMarkedRegion(existing: string, generatedRegion: string): string {
  const currentRegion = extractMarkedRegion(existing);
  if (!currentRegion) {
    return `${generatedRegion.trim()}\n\n${existing.trimStart()}`.trimEnd();
  }
  return existing.replace(currentRegion, generatedRegion.trim());
}

export function hasMarkedRegion(content: string): boolean {
  return extractMarkedRegion(content) !== null;
}

// Strips the generated region (and its markers) while keeping the user's surrounding content.
// Returns "" when nothing but the region remained, so callers can keep an empty shell file.
export function removeMarkedRegion(content: string): string {
  const region = extractMarkedRegion(content);
  if (!region) {
    return content;
  }
  const remaining = content
    .replace(region, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return remaining ? `${remaining}\n` : "";
}

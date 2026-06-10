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

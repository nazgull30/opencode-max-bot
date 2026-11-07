import type { MAXRenderedPart } from "./types.js";

/**
 * Stable identity of what was actually delivered to MAX. The streamer compares
 * signatures to skip unchanged edits, so the signature must describe the
 * representation that was sent, not the one that was rendered.
 */
export function getMAXRenderedPartSignature(
  part: Pick<MAXRenderedPart, "html" | "fallbackText" | "source" | "entities">,
): string {
  if (part.source === "plain" || !part.html) {
    const entities = part.entities?.length ? JSON.stringify(part.entities) : "";
    return `plain\n${entities}\n${part.fallbackText}`;
  }

  return `html\n${part.html}`;
}

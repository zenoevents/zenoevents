/**
 * Content-Disposition's filename= must be a ByteString (Latin-1) — a name
 * built from free text (contract subject, employee name, ...) throws a
 * TypeError at the Response layer the moment it contains an em dash,
 * accented letter, or anything else outside Latin-1. Strip to ASCII for
 * the plain filename and carry the real name via filename* (RFC 5987) so
 * browsers that support it still show the full title.
 */
export function contentDisposition(disposition: "inline" | "attachment", rawFilename: string, fallback: string): string {
  const asciiFilename = rawFilename.replace(/[^\x20-\x7E]/g, "").replace(/_+/g, "_") || fallback;
  const encodedFilename = encodeURIComponent(rawFilename);
  return `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`;
}

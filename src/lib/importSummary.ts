export type ImportSummaryCounts = {
  added: number;
  inLibrary: number;
  failed: number;
  unsupported: number;
};

export function formatImportSummary({
  added,
  inLibrary,
  failed,
  unsupported,
}: ImportSummaryCounts): string | null {
  const parts: string[] = [];
  if (added) parts.push(`${added} imported`);
  if (inLibrary) parts.push(`${inLibrary} already in library`);
  if (failed) parts.push(`${failed} failed to copy`);
  if (unsupported) parts.push(`${unsupported} unsupported`);
  return parts.length ? parts.join(" · ") : null;
}

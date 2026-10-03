// Proposed presentation model only. No production API adapter exists yet.
export function validateCatalogName(name, records, currentId) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Enter a name.");
  if (trimmed.length > 100) throw new Error("Use 100 characters or fewer.");
  if (records.some(record => record.id !== currentId && record.name.trim().toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That name already exists. Choose a different name.");
  }
  return trimmed;
}

export function validateReplacement(record, replacementId, records) {
  if (!replacementId && record.usageCount > 0) throw new Error("Choose a replacement before deleting this value.");
  if (replacementId && !records.some(candidate => candidate.id === replacementId && candidate.id !== record.id)) {
    throw new Error("Choose an available replacement.");
  }
  return replacementId || null;
}

export function needsCatalogReload(error) {
  // Only explicit validation failures are safe to correct and resubmit.
  return ![400, 422].includes(error.status);
}

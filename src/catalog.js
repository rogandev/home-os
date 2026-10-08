// API PR78 contract helpers. Production integration remains disabled.
export function validateCatalogName(name, records, currentId) {
  const trimmed = name.replace(/\s+/gu, " ").trim();
  if (/[\u0000-\u0008\u000e-\u001f\u007f]/u.test(trimmed)) throw new Error("Remove control characters from the name.");
  if (!trimmed) throw new Error("Enter a name.");
  if ([...trimmed].length > 100) throw new Error("Use 100 characters or fewer.");
  if (records.some(record => record.id !== currentId && record.name.replace(/\s+/gu, " ").trim().toLowerCase() === trimmed.toLowerCase())) {
    throw new Error("That name already exists. Choose a different name.");
  }
  return trimmed;
}

export function validateReplacement(record, replacementId, records) {
  if (record.isProtected) throw new Error("This legacy location cannot be deleted.");
  if (!replacementId && record.usageCount > 0) throw new Error("Choose a replacement before deleting this value.");
  if (replacementId && !records.some(candidate => candidate.id === replacementId && candidate.id !== record.id && isAssignable(candidate))) {
    throw new Error("Choose an available replacement.");
  }
  return replacementId || null;
}

export function needsCatalogReload(error) {
  // Only explicit validation failures are safe to correct and resubmit.
  return ![400, 422].includes(error.status);
}

export function isAssignable(record) {
  return record.isActive === true && !record.deletedAt;
}

// Build only changed reference fields. Inactive current references can remain
// unchanged on unrelated edits, but cannot be chosen for a new assignment.
export function canonicalItemReferences(values, initial, catalogs) {
  const result = {};
  for (const [field, kind] of [["categoryId", "categories"], ["locationId", "locations"]]) {
    if (initial && values[field] === initial[field]) continue;
    if (!catalogs[kind].some(record => record.id === values[field] && isAssignable(record))) {
      throw new Error(`Choose an active ${kind === "categories" ? "category" : "location"}.`);
    }
    result[field] = values[field];
  }
  return result;
}

export function catalogConflictMessage(error) {
  if (error.code === "HOME_OS_CONTAINER_NAME_CONFLICT") return "The destination has a container with the same name. Choose another destination, or rename a non-protected container first. No stock was merged.";
  if (error.code === "HOME_OS_PROTECTED_LOCATION") return "This location contains protected legacy containers and cannot be deleted.";
  if (error.code === "HOME_OS_CATALOG_NAME_CONFLICT") return "That name is reserved by an existing or historical value. Reload and choose another name.";
  return error.message || "Values changed elsewhere. Reload before making another change.";
}

export function catalogOptions(records, currentId, currentName) {
  const choices = records.filter(isAssignable).map(record => ({ value: record.id, label: record.name }));
  if (currentId && !choices.some(choice => choice.value === currentId)) {
    const record = records.find(candidate => candidate.id === currentId);
    choices.unshift({ value: currentId, label: `${record?.name || currentName || currentId} (unavailable · unchanged)` });
  }
  return [{ value: "", label: "Choose a value" }, ...choices];
}

export function canonicalItemPayload(form, initial, catalogs) {
  const { category, location, categoryId, locationId, ...fields } = form;
  return { ...fields, ...canonicalItemReferences({ categoryId, locationId }, initial?.id ? initial : null, catalogs) };
}

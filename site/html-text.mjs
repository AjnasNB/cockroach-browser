const SAFE_TEXT_ENTITIES = Object.freeze({
  amp: "&",
  quot: '"',
  "#39": "'"
});

export function stripHtml(value) {
  const source = String(value);
  let text = "";
  let cursor = 0;

  while (cursor < source.length) {
    const tagStart = source.indexOf("<", cursor);
    if (tagStart === -1) {
      text += source.slice(cursor);
      break;
    }
    text += source.slice(cursor, tagStart);
    const tagEnd = source.indexOf(">", tagStart + 1);
    if (tagEnd === -1) break;

    const tag = source.slice(tagStart + 1, tagEnd).trim().toLowerCase();
    if (tag === "li" || tag.startsWith("li ")) text += "- ";
    if (tag === "/li" || tag.startsWith("/li ")) text += "\n";
    cursor = tagEnd + 1;
  }

  return decodeSafeTextEntities(text).trim();
}

function decodeSafeTextEntities(value) {
  return value.replace(/&(amp|quot|#39);/g, (_match, entity) => SAFE_TEXT_ENTITIES[entity]);
}

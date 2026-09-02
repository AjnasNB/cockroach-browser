const namedEntities = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["#39", "'"]
]);

export function htmlToPlainText(value) {
  const source = String(value);
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    if (source[cursor] === "<") {
      const tagEnd = source.indexOf(">", cursor + 1);
      if (tagEnd === -1) {
        output += source.slice(cursor);
        break;
      }
      const tag = source.slice(cursor + 1, tagEnd).trim().toLowerCase();
      if (tag === "li") output += "- ";
      else if (tag === "/li") output += "\n";
      cursor = tagEnd + 1;
      continue;
    }

    if (source[cursor] === "&") {
      const entityEnd = source.indexOf(";", cursor + 1);
      if (entityEnd !== -1) {
        const entity = source.slice(cursor + 1, entityEnd);
        const decoded = namedEntities.get(entity);
        if (decoded !== undefined) {
          output += decoded;
          cursor = entityEnd + 1;
          continue;
        }
      }
    }

    output += source[cursor];
    cursor += 1;
  }

  return output.trim();
}

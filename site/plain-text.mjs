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
      const tagName = tag.match(/^\/?\s*([a-z][a-z0-9-]*)/)?.[1];
      const closing = tag.startsWith("/");
      if (tagName === "li") output += closing ? "\n" : "- ";
      else if (tagName === "br") output += "\n";
      else if (tagName && [
        "address", "article", "aside", "blockquote", "dd", "div", "dl", "dt", "fieldset",
        "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6",
        "header", "hr", "main", "nav", "ol", "p", "pre", "section", "table", "tr", "ul"
      ].includes(tagName)) {
        output += "\n\n";
      } else if (tagName && ["td", "th"].includes(tagName) && closing) {
        output += "\t";
      }
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

  return output
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

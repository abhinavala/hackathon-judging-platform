// RFC 4180 CSV, as Google Forms and Google Sheets export it: comma
// separated, fields quoted with " when they contain commas, quotes or line
// breaks, quotes doubled inside a quoted field, CRLF or LF line endings.
// Pure; no dependencies.

/** Parses CSV text into rows of fields. Tolerates a UTF-8 BOM and a trailing newline. */
export function parseCsv(text: string): string[][] {
  return parseCsvRecords(text).map((r) => r.fields);
}

/**
 * Like parseCsv, with the 1-based physical line each record starts on. A
 * quoted field can contain line breaks (Google Forms puts a question's help
 * text inside the header cell), so record N is not line N.
 */
export function parseCsvRecords(
  text: string,
): { fields: string[]; line: number }[] {
  const records: { fields: string[]; line: number }[] = [];
  let line = 1;
  let recordLine = 1;
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endField = () => {
    row.push(field);
    field = "";
  };
  const endRow = () => {
    endField();
    records.push({ fields: row, line: recordLine });
    row = [];
  };

  for (; i < text.length; i++) {
    const ch = text[i];
    // Count physical lines everywhere, quoted or not; a CRLF outside quotes
    // is counted below, where its \n is skipped.
    if (ch === "\n") line++;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"' && field === "") {
      quoted = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i++;
        line++;
      } else if (ch === "\r") {
        line++;
      }
      endRow();
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error("CSV ends inside a quoted field");
  if (field !== "" || row.length > 0) endRow();
  return records;
}

/** Formats rows as CSV with CRLF line endings, quoting only where needed. */
export function formatCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row
        .map((f) => (/[",\r\n]/.test(f) ? `"${f.replace(/"/g, '""')}"` : f))
        .join(","),
    )
    .join("\r\n")
    .concat("\r\n");
}

/**
 * Neutralises spreadsheet formula injection for a cell that will be opened
 * in Sheets or Excel: text a participant typed (a team name) starting with
 * = + - @ would otherwise be evaluated as a formula. A leading apostrophe
 * makes the spreadsheet treat it as text.
 */
export function spreadsheetSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

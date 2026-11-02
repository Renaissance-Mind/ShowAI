// Source evaluated inside every transform sandbox before the script. It
// defines the `helpers` argument of transform(inputs, helpers): spreadsheet
// conveniences for the workbook shape {sheets: [{name, rows}]} that linked
// .xlsx files read as. Rows and columns are 0-based indices; cell references
// use the spreadsheet's A1 notation. It also checks the returned output, so
// a value JSON cannot hold is reported with its path.
//
// The source evaluates to {run, output}: run(text) parses the inputs and calls
// the script's transform; output() returns the result as JSON text or throws
// an error named OutputInvalid.

export const TRANSFORM_HELPERS_SOURCE = String.raw`(function () {
  "use strict";
  function fail(message) {
    throw new TypeError(message);
  }
  function columnIndex(letters) {
    let index = 0;
    for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
    return index - 1;
  }
  function columnName(index) {
    let name = "";
    for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26))
      name = String.fromCharCode(65 + ((rest - 1) % 26)) + name;
    return name;
  }
  function address(ref) {
    const match = /^\$?([A-Za-z]{1,3})\$?([1-9][0-9]{0,6})$/.exec(String(ref).trim());
    if (!match) fail(JSON.stringify(ref) + " is not a cell reference like B3.");
    return { row: Number(match[2]) - 1, column: columnIndex(match[1].toUpperCase()) };
  }
  function rowsOf(sheet) {
    if (Array.isArray(sheet)) return sheet;
    if (sheet && Array.isArray(sheet.rows)) return sheet.rows;
    fail("Expected a sheet {name, rows} or an array of rows.");
  }
  function at(rows, row, column) {
    const line = rows[row];
    const value = Array.isArray(line) ? line[column] : undefined;
    return value === undefined ? null : value;
  }
  const blank = (value) => value === null || value === undefined || value === "";

  /** A sheet of a workbook by name or 0-based index (default: the first). */
  function sheet(book, nameOrIndex) {
    if (!book || !Array.isArray(book.sheets))
      fail("Expected a workbook {sheets: [{name, rows}]}.");
    const which = nameOrIndex === undefined ? 0 : nameOrIndex;
    const found =
      typeof which === "number"
        ? book.sheets[which]
        : book.sheets.find((item) => item && item.name === which);
    if (!found)
      fail(
        "Sheet " + JSON.stringify(which) + " not found; the workbook has " +
          JSON.stringify(book.sheets.map((item) => item && item.name)) + ".",
      );
    return found;
  }
  /** The value of one cell ("B3"); null when empty or outside the sheet. */
  function cell(sheet, ref) {
    const { row, column } = address(ref);
    return at(rowsOf(sheet), row, column);
  }
  /** A rectangle of cells ("A1:C10") as rows of values, empty cells null. */
  function range(sheet, ref) {
    const parts = String(ref).split(":");
    if (parts.length !== 2) fail(JSON.stringify(ref) + " is not a range like A1:C10.");
    const start = address(parts[0]), end = address(parts[1]);
    const rows = rowsOf(sheet), result = [];
    for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row++) {
      const line = [];
      for (let column = Math.min(start.column, end.column); column <= Math.max(start.column, end.column); column++)
        line.push(at(rows, row, column));
      result.push(line);
    }
    return result;
  }
  /**
   * Rows below a header row as objects keyed by the header's text (unnamed
   * columns by their letter), up to the first blank row. options.header is
   * the header's 0-based row index (default 0).
   */
  function table(rows, options) {
    rows = rowsOf(rows);
    const header = options && options.header !== undefined ? options.header : 0;
    if (!Number.isInteger(header) || header < 0) fail("table: header is a 0-based row index.");
    const names = (Array.isArray(rows[header]) ? rows[header] : []).map((value, index) =>
      blank(value) ? columnName(index) : String(value).trim(),
    );
    const records = [];
    for (let row = header + 1; row < rows.length; row++) {
      const line = Array.isArray(rows[row]) ? rows[row] : [];
      if (line.every(blank)) break;
      const record = {};
      names.forEach((name, index) => {
        record[name] = line[index] === undefined ? null : line[index];
      });
      records.push(record);
    }
    return records;
  }
  /**
   * The first cell, row by row, whose value matches: a function called with
   * (value, {row, column}) or a value compared with ===. Returns
   * {row, column, ref, value} or null.
   */
  function find(sheet, predicate) {
    const test = typeof predicate === "function" ? predicate : (value) => value === predicate;
    const rows = rowsOf(sheet);
    for (let row = 0; row < rows.length; row++) {
      const line = Array.isArray(rows[row]) ? rows[row] : [];
      for (let column = 0; column < line.length; column++) {
        const value = line[column] === undefined ? null : line[column];
        if (test(value, { row, column }))
          return { row, column, ref: columnName(column) + (row + 1), value };
      }
    }
    return null;
  }
  const helpers = Object.freeze({ sheet, cell, range, table, find, columnName });

  function invalid(message) {
    const error = new Error(message);
    error.name = "OutputInvalid";
    throw error;
  }
  function label(path) {
    return "the output" + path.join("");
  }
  /** A copy of value with only JSON data, or OutputInvalid naming the path. */
  function check(value, path, depth) {
    if (depth > 64) invalid(label(path) + " is nested deeper than 64 levels.");
    if (value === null || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) invalid(label(path) + " is " + value + "; numbers must be finite.");
      return value;
    }
    if (Array.isArray(value))
      return value.map((item, index) => {
        if (item === undefined) invalid(label(path.concat("[" + index + "]")) + " is undefined; use null.");
        return check(item, path.concat("[" + index + "]"), depth + 1);
      });
    if (typeof value === "object") {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        invalid(label(path) + " is a " + (value.constructor && value.constructor.name || "class instance") + "; return plain objects, arrays, strings, numbers, booleans or null.");
      if (typeof value.then === "function")
        invalid(label(path) + " is a promise; transform returns its output directly.");
      const copy = {};
      for (const key of Object.keys(value)) {
        if (value[key] === undefined) continue;
        copy[key] = check(value[key], path.concat("." + key), depth + 1);
      }
      return copy;
    }
    invalid(label(path) + " is a " + typeof value + "; return JSON data only.");
  }

  let result;
  return {
    run(text) {
      if (typeof transform !== "function")
        throw new TypeError("The script defines no function transform(inputs, helpers).");
      result = transform(JSON.parse(text), helpers);
    },
    output() {
      if (result === undefined) invalid("transform returned nothing; return the output value.");
      return JSON.stringify(check(result, [], 0));
    },
  };
})()`;

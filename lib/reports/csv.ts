/** CSV for accountants and teachers. Cells that start with = + - @ are prefixed so spreadsheets never run them as formulas. */
export function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], columns: { key: keyof T & string; header: string }[]): string {
  const head = columns.map((c) => cell(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => cell(r[c.key])).join(","));
  return "﻿" + [head, ...body].join("\r\n") + "\r\n"; // BOM so Excel reads UTF-8 names correctly
}

export const minutes = (secs: number) => Math.round(secs / 60);

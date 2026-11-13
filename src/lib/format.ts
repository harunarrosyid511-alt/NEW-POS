export function rupiah(value: number | string | null | undefined): string {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function tanggal(value: string | Date | null | undefined): string {
  if (!value) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(new Date(value));
}

export function localDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
}

export function dateInputValue(value: string | null | undefined): string {
  if (!value) return localDate();
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date(value));
}

export function timestampOnJakartaDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || Number.isNaN(calendarDate.getTime())
    || calendarDate.toISOString().slice(0, 10) !== value
  ) {
    throw new Error("Tanggal tidak valid.");
  }

  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jakarta",
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date());
  const timePart = (type: Intl.DateTimeFormatPartTypes) =>
    nowParts.find((part) => part.type === type)?.value;
  const time = `${timePart("hour")}:${timePart("minute")}:${timePart("second")}`;
  return new Date(`${value}T${time}+07:00`).toISOString();
}

export function csvDownload(filename: string, rows: (string | number)[][]): void {
  const content = rows.map((row) => row.map((cell) =>
    `"${String(cell).replaceAll('"', '""')}"`,
  ).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

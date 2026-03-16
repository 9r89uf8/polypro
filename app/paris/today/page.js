import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const PARIS_TIMEZONE = "Europe/Paris";

function getDateParts(formatter, date) {
  const parts = formatter.formatToParts(date);
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  }
  return values;
}

function parisTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: PARIS_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = getDateParts(formatter, new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function ParisTodayRedirectPage() {
  redirect(`/paris/day/${parisTodayKey()}`);
}

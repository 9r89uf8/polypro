import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const AUCKLAND_TIMEZONE = "Pacific/Auckland";

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

function aucklandTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: AUCKLAND_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = getDateParts(formatter, new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function NzwnTodayRedirectPage() {
  redirect(`/nzwn/day/${aucklandTodayKey()}`);
}

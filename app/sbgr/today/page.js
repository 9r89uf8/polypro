import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const SAO_PAULO_TIMEZONE = "America/Sao_Paulo";

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

function saoPauloTodayKey() {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SAO_PAULO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = getDateParts(formatter, new Date());
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export default function SbgrTodayRedirectPage() {
  redirect(`/sbgr/day/${saoPauloTodayKey()}`);
}

import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

const MEXICO_TIMEZONE = "America/Mexico_City";

function mexicoTodayKey() {
  const parts = {};
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: MEXICO_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  for (const part of formatter.formatToParts(new Date())) {
    if (part.type !== "literal") {
      parts[part.type] = part.value;
    }
  }
  return [parts.year, parts.month, parts.day].join("-");
}

export default function MexicoTodayRedirectPage() {
  redirect("/mexico/day/" + mexicoTodayKey());
}

import { redirect } from "next/navigation";

export default function AnkaraTodayPage() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const values = {};
  for (const part of parts) {
    if (part.type !== "literal") values[part.type] = part.value;
  }
  const todayKey = `${values.year}-${values.month}-${values.day}`;
  redirect(`/ankara/day/${todayKey}`);
}

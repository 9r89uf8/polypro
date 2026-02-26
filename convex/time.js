export function getLocalParts(ms, timeZone) {
    const dtf = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        hourCycle: "h23",
    });

    const parts = dtf.formatToParts(new Date(ms));
    const m = {};
    for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;

    return {
        dateISO: `${m.year}-${m.month}-${m.day}`,
        hour: Number(m.hour),
        minute: Number(m.minute),
    };
}

export function localMidnightEpochMs(dateISO, timeZone) {
    const [y, mo, d] = dateISO.split("-").map(Number);
    const utcMidnight = Date.UTC(y, mo - 1, d, 0, 0, 0);

    // Search +/- 14h in 1-minute steps to find the local 00:00 timestamp.
    const start = utcMidnight - 14 * 3600000;
    for (let i = 0; i <= 28 * 60; i++) {
        const t = start + i * 60000;
        const p = getLocalParts(t, timeZone);
        if (p.dateISO === dateISO && p.hour === 0 && p.minute === 0) return t;
    }

    throw new Error(`Could not find local midnight for ${dateISO} in ${timeZone}`);
}

export function addDaysISO(dateISO, days) {
    const [y, mo, d] = dateISO.split("-").map(Number);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    dt.setUTCDate(dt.getUTCDate() + days);
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(dt.getUTCDate()).padStart(2, "0");
    return `${yy}-${mm}-${dd}`;
}

export function hourBucketMs(ms) {
    return Math.floor(ms / 3600000) * 3600000;
}

import { mutationGeneric, queryGeneric } from "convex/server";
import { v } from "convex/values";

function normalizeOptionalText(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function assertValidDateRange(startTs, endTs) {
  if (startTs !== undefined && !Number.isFinite(startTs)) {
    throw new Error("Invalid start timestamp.");
  }
  if (endTs !== undefined && !Number.isFinite(endTs)) {
    throw new Error("Invalid end timestamp.");
  }
  if (
    startTs !== undefined &&
    endTs !== undefined &&
    startTs >= endTs
  ) {
    throw new Error("Invalid date range.");
  }
}

async function listRowsByRange(ctx, startTs, endTs) {
  if (startTs !== undefined && endTs !== undefined) {
    return await ctx.db
      .query("notes")
      .withIndex("by_createdAt", (query) =>
        query.gte("createdAt", startTs).lt("createdAt", endTs),
      )
      .order("desc")
      .collect();
  }

  if (startTs !== undefined) {
    return await ctx.db
      .query("notes")
      .withIndex("by_createdAt", (query) => query.gte("createdAt", startTs))
      .order("desc")
      .collect();
  }

  if (endTs !== undefined) {
    return await ctx.db
      .query("notes")
      .withIndex("by_createdAt", (query) => query.lt("createdAt", endTs))
      .order("desc")
      .collect();
  }

  return await ctx.db
    .query("notes")
    .withIndex("by_createdAt", (query) => query)
    .order("desc")
    .collect();
}

export const generateImageUploadUrl = mutationGeneric({
  args: {},
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const createNote = mutationGeneric({
  args: {
    title: v.optional(v.string()),
    body: v.optional(v.string()),
    imageIds: v.array(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    const title = normalizeOptionalText(args.title);
    const body = normalizeOptionalText(args.body);

    if (!title && !body && args.imageIds.length === 0) {
      throw new Error("Add a title, note, or image before saving.");
    }

    const now = Date.now();
    const noteId = await ctx.db.insert("notes", {
      title,
      body,
      imageIds: args.imageIds,
      createdAt: now,
      updatedAt: now,
    });

    return { noteId };
  },
});

export const listNotes = queryGeneric({
  args: {
    startTs: v.optional(v.number()),
    endTs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    assertValidDateRange(args.startTs, args.endTs);
    const rows = await listRowsByRange(ctx, args.startTs, args.endTs);

    return await Promise.all(
      rows.map(async (row) => {
        const images = await Promise.all(
          row.imageIds.map(async (storageId) => ({
            storageId,
            url: await ctx.storage.getUrl(storageId),
          })),
        );

        return {
          ...row,
          images,
        };
      }),
    );
  },
});

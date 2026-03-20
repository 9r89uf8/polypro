"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { useEffect, useMemo, useState } from "react";

function parseDateInput(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || "");
  if (!match) {
    return null;
  }

  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function toLocalDayStartMs(value) {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return null;
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day, 0, 0, 0, 0).getTime();
}

function toLocalDayEndExclusiveMs(value) {
  const parsed = parseDateInput(value);
  if (!parsed) {
    return null;
  }
  return new Date(parsed.year, parsed.month - 1, parsed.day + 1, 0, 0, 0, 0).getTime();
}

function formatCreatedAt(value) {
  return new Date(value).toLocaleString();
}

function normalizeStationInput(value) {
  return value.trim().toUpperCase();
}

function extensionForMime(mimeType) {
  if (mimeType === "image/jpeg") {
    return "jpg";
  }
  if (mimeType === "image/webp") {
    return "webp";
  }
  if (mimeType === "image/gif") {
    return "gif";
  }
  return "png";
}

function normalizeImageFiles(files) {
  return files
    .filter((file) => file && file.type && file.type.startsWith("image/"))
    .map((file, index) => {
      if (file.name && file.name.trim().length > 0) {
        return file;
      }
      const extension = extensionForMime(file.type);
      return new File([file], `pasted-${Date.now()}-${index + 1}.${extension}`, {
        type: file.type || "image/png",
        lastModified: Date.now(),
      });
    });
}

function fileIdentity(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export default function NotesWorkspaceClient({
  prefilledStationIcao = "",
}) {
  const normalizedPrefilledStationIcao = normalizeStationInput(prefilledStationIcao);
  const [stationIcao, setStationIcao] = useState(normalizedPrefilledStationIcao);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageFiles, setImageFiles] = useState([]);

  const [filterStationIcao, setFilterStationIcao] = useState(
    normalizedPrefilledStationIcao,
  );
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState(null);
  const [feedback, setFeedback] = useState(null);

  const [previewImages, setPreviewImages] = useState([]);

  const generateImageUploadUrl = useMutation("notes:generateImageUploadUrl");
  const createNote = useMutation("notes:createNote");
  const deleteNote = useMutation("notes:deleteNote");

  useEffect(() => {
    if (!normalizedPrefilledStationIcao) {
      return;
    }
    setStationIcao((current) => current || normalizedPrefilledStationIcao);
    setFilterStationIcao((current) => current || normalizedPrefilledStationIcao);
  }, [normalizedPrefilledStationIcao]);

  useEffect(() => {
    const nextPreviews = imageFiles.map((file) => ({
      key: fileIdentity(file),
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    setPreviewImages(nextPreviews);

    return () => {
      for (const preview of nextPreviews) {
        URL.revokeObjectURL(preview.url);
      }
    };
  }, [imageFiles]);

  const dateRangeError =
    fromDate && toDate && fromDate > toDate
      ? "From date must be on or before To date."
      : "";

  const noteFilterArgs = useMemo(() => {
    const args = {};
    const startTs = toLocalDayStartMs(fromDate);
    const endTs = toLocalDayEndExclusiveMs(toDate);
    const normalizedStationIcao = normalizeStationInput(filterStationIcao);

    if (startTs !== null) {
      args.startTs = startTs;
    }
    if (endTs !== null) {
      args.endTs = endTs;
    }
    if (normalizedStationIcao) {
      args.stationIcao = normalizedStationIcao;
    }

    return args;
  }, [filterStationIcao, fromDate, toDate]);

  const notes = useQuery("notes:listNotes", dateRangeError ? "skip" : noteFilterArgs);

  function appendImages(newFiles) {
    if (!newFiles.length) {
      return;
    }

    setImageFiles((current) => {
      const existing = new Set(current.map((file) => fileIdentity(file)));
      const merged = [...current];

      for (const file of newFiles) {
        const identity = fileIdentity(file);
        if (existing.has(identity)) {
          continue;
        }
        existing.add(identity);
        merged.push(file);
      }

      return merged;
    });
  }

  function handleFileInputChange(event) {
    const selectedFiles = normalizeImageFiles(Array.from(event.target.files || []));
    appendImages(selectedFiles);
    if (selectedFiles.length > 0) {
      setFeedback({
        type: "success",
        message: `${selectedFiles.length} image(s) added.`,
      });
    }
    event.target.value = "";
  }

  function handlePaste(event) {
    const items = Array.from(event.clipboardData?.items || []);
    const pasted = normalizeImageFiles(
      items
        .map((item) => {
          if (item.kind !== "file") {
            return null;
          }
          return item.getAsFile();
        })
        .filter(Boolean),
    );

    if (pasted.length > 0) {
      event.preventDefault();
      appendImages(pasted);
      setFeedback({
        type: "success",
        message: `${pasted.length} image(s) pasted from clipboard.`,
      });
    }
  }

  function removeImage(indexToRemove) {
    setImageFiles((current) =>
      current.filter((_, index) => index !== indexToRemove),
    );
  }

  async function uploadImage(file) {
    const uploadUrl = await generateImageUploadUrl({});
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Content-Type": file.type || "application/octet-stream",
      },
      body: file,
    });

    if (!response.ok) {
      throw new Error(`Image upload failed (${response.status}).`);
    }

    const payload = await response.json();
    if (!payload || typeof payload.storageId !== "string") {
      throw new Error("Image upload failed: missing storageId.");
    }

    return payload.storageId;
  }

  async function handleCreateNote(event) {
    event.preventDefault();
    const normalizedStationIcao = normalizeStationInput(stationIcao);
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();

    if (!trimmedTitle && !trimmedBody && imageFiles.length === 0) {
      setFeedback({
        type: "error",
        message: "Add a title, note text, or at least one image.",
      });
      return;
    }

    setIsSaving(true);
    setFeedback(null);

    try {
      const imageIds = [];
      for (const file of imageFiles) {
        const storageId = await uploadImage(file);
        imageIds.push(storageId);
      }

      await createNote({
        stationIcao: normalizedStationIcao || undefined,
        title: trimmedTitle || undefined,
        body: trimmedBody || undefined,
        imageIds,
      });

      setStationIcao(normalizedPrefilledStationIcao);
      setTitle("");
      setBody("");
      setImageFiles([]);
      setFeedback({
        type: "success",
        message: `Note saved${normalizedStationIcao ? ` for ${normalizedStationIcao}` : ""}${imageIds.length ? ` with ${imageIds.length} image(s)` : ""}.`,
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteNote(note) {
    const label = note.title || note.body?.slice(0, 60) || "this note";
    const confirmed = window.confirm(`Delete ${label}?`);
    if (!confirmed) {
      return;
    }

    setDeletingNoteId(note._id);
    setFeedback(null);
    try {
      await deleteNote({ noteId: note._id });
      setFeedback({
        type: "success",
        message: "Note deleted.",
      });
    } catch (error) {
      setFeedback({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDeletingNoteId(null);
    }
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.12)] md:p-8">
          <p className="inline-flex rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold tracking-[0.18em] text-accent">
            NOTES
          </p>
          <h1 className="mt-3 text-2xl font-semibold leading-tight text-foreground md:text-4xl">
            Notes with Screenshot Support
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-black/70 md:text-base">
            Write notes, optionally add a title, and paste or upload images.
            Filter your note list by date when reviewing past entries.
          </p>
          {normalizedPrefilledStationIcao ? (
            <p className="mt-3 inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-sky-800">
              Prefilled station {normalizedPrefilledStationIcao}
            </p>
          ) : null}
          <Link
            href="/"
            className="mt-5 inline-flex rounded-full border border-black/15 px-4 py-2 text-sm font-semibold text-black transition hover:border-black hover:text-black"
          >
            Back Home
          </Link>
        </header>

        <section className="grid gap-6 xl:grid-cols-2">
          <article className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">New Note</h2>
            <form onSubmit={handleCreateNote} onPaste={handlePaste} className="mt-4 space-y-4">
              <label className="block text-sm">
                <span className="font-medium text-black/70">
                  Station / Airport (optional)
                </span>
                <input
                  type="text"
                  value={stationIcao}
                  onChange={(event) => setStationIcao(normalizeStationInput(event.target.value))}
                  placeholder="NZWN"
                  className="mt-1.5 w-full rounded-xl border border-black/20 bg-white/80 px-3 py-2 text-sm uppercase outline-none ring-accent focus:ring-2"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-black/70">
                  Title (optional)
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Quick heading"
                  className="mt-1.5 w-full rounded-xl border border-black/20 bg-white/80 px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium text-black/70">Note</span>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  placeholder="Write note text here. You can also paste screenshots."
                  className="mt-1.5 h-40 w-full rounded-2xl border border-black/20 bg-white/80 px-4 py-3 text-sm outline-none ring-accent focus:ring-2"
                />
              </label>

              <div>
                <label className="inline-flex cursor-pointer items-center rounded-full border border-black/20 bg-white/80 px-4 py-2 text-sm font-semibold text-black transition hover:border-black">
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleFileInputChange}
                    className="hidden"
                  />
                  Add Images
                </label>
                <p className="mt-2 text-xs text-black/60">
                  Paste screenshots with Ctrl/Cmd+V or use file picker.
                </p>
              </div>

              {previewImages.length > 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {previewImages.map((preview, index) => (
                    <figure
                      key={preview.key}
                      className="rounded-2xl border border-black/10 bg-white/70 p-2"
                    >
                      <img
                        src={preview.url}
                        alt={`Selected upload ${index + 1}`}
                        className="h-36 w-full rounded-xl object-cover"
                      />
                      <figcaption className="mt-2 flex items-center justify-between gap-2">
                        <span className="truncate text-xs text-black/65">
                          {preview.name}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          className="rounded-full border border-black/20 px-2.5 py-1 text-xs font-semibold text-black/70 transition hover:border-black hover:text-black"
                        >
                          Remove
                        </button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isSaving}
                className="rounded-full border border-accent bg-accent px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Note"}
              </button>

              {feedback ? (
                <p
                  className={`rounded-xl px-3 py-2 text-sm ${
                    feedback.type === "error"
                      ? "border border-red-300 bg-red-50 text-red-800"
                      : "border border-black/10 bg-black/5 text-black/80"
                  }`}
                >
                  {feedback.message}
                </p>
              ) : null}
            </form>
          </article>

          <article className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
            <h2 className="text-lg font-semibold text-foreground">Filter Notes</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <label className="text-sm">
                <span className="font-medium text-black/70">Station</span>
                <input
                  type="text"
                  value={filterStationIcao}
                  onChange={(event) =>
                    setFilterStationIcao(normalizeStationInput(event.target.value))
                  }
                  placeholder="All stations"
                  className="mt-1.5 w-full rounded-xl border border-black/20 bg-white/80 px-3 py-2 text-sm uppercase outline-none ring-accent focus:ring-2"
                />
              </label>
              <label className="text-sm">
                <span className="font-medium text-black/70">From</span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-black/20 bg-white/80 px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
                />
              </label>
              <label className="text-sm">
                <span className="font-medium text-black/70">To</span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-black/20 bg-white/80 px-3 py-2 text-sm outline-none ring-accent focus:ring-2"
                />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setFilterStationIcao("");
                  setFromDate("");
                  setToDate("");
                }}
                className="rounded-full border border-black/20 bg-white/80 px-4 py-2 text-sm font-semibold text-black transition hover:border-black"
              >
                Clear Filter
              </button>
              <p className="text-xs text-black/60">
                Empty filters show all notes.
              </p>
            </div>
            {dateRangeError ? (
              <p className="mt-3 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
                {dateRangeError}
              </p>
            ) : null}
            <p className="mt-4 text-sm text-black/70">
              {notes === undefined
                ? "Loading notes..."
                : `Showing ${notes.length} note(s).`}
            </p>
          </article>
        </section>

        <section className="rounded-3xl border border-line/80 bg-panel/90 p-6 shadow-[0_18px_50px_rgba(37,35,27,0.08)]">
          <h2 className="text-lg font-semibold text-foreground">All Notes</h2>
          {dateRangeError ? (
            <p className="mt-4 text-sm text-black/70">
              Fix the date filter to load notes.
            </p>
          ) : notes === undefined ? (
            <p className="mt-4 text-sm text-black/70">Loading notes...</p>
          ) : notes.length === 0 ? (
            <p className="mt-4 text-sm text-black/70">
              No notes found for this filter.
            </p>
          ) : (
            <div className="mt-4 grid gap-4">
              {notes.map((note) => (
                <article
                  key={note._id}
                  className="rounded-2xl border border-black/10 bg-white/75 p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/55">
                    <span>{formatCreatedAt(note.createdAt)}</span>
                    {note.stationIcao ? (
                      <span className="inline-flex rounded-full bg-sky-50 px-2 py-1 text-[11px] text-sky-800">
                        {note.stationIcao}
                      </span>
                    ) : null}
                  </div>
                  {note.title ? (
                    <h3 className="mt-2 text-lg font-semibold text-black">{note.title}</h3>
                  ) : null}
                  {note.body ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-black/80">
                      {note.body}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleDeleteNote(note)}
                      disabled={deletingNoteId === note._id}
                      className="rounded-full border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {deletingNoteId === note._id ? "Deleting..." : "Delete Note"}
                    </button>
                  </div>
                  {note.images.length > 0 ? (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {note.images.map((image, imageIndex) =>
                        image.url ? (
                          <a
                            key={`${note._id}-${image.storageId}`}
                            href={image.url}
                            target="_blank"
                            rel="noreferrer"
                            className="overflow-hidden rounded-xl border border-black/10 bg-white"
                          >
                            <img
                              src={image.url}
                              alt={`Note image ${imageIndex + 1}`}
                              className="h-40 w-full object-cover transition hover:scale-[1.02]"
                            />
                          </a>
                        ) : null,
                      )}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

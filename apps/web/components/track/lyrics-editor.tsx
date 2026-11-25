"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvided,
  type DropResult,
} from "@hello-pangea/dnd";
import { GripVertical, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type {
  SanitizedTrack,
  SyncedLyricsPayload,
  TrackRecord,
} from "@repo/types";
import {
  fromEditableLines,
  lineStart,
  lineText,
  moveAnnotation,
  setLineStart,
  setLineText,
  shiftLines,
  toEditableLines,
  type AnnotationField,
  type EditableLine,
} from "@repo/lyrics/editor";
import {
  editTrack,
  TrackEditError,
  type TrackEdit,
  type TrackIdField,
} from "@/lib/api-client";
import { fade, press, spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface LyricsEditorProps {
  open: boolean;
  track: SanitizedTrack<TrackRecord>;
  lyrics: SyncedLyricsPayload | null;
  onClose: () => void;
  onSaved: (
    track: SanitizedTrack<TrackRecord>,
    lyrics: SyncedLyricsPayload | null,
  ) => void;
  // Runs a fresh Turnstile challenge (undefined when human verification is off)
  getTurnstileToken: (action: string) => Promise<string | undefined>;
}

interface Row {
  key: number;
  line: EditableLine;
}

type EditorTab = "lyrics" | "ids";

const ID_FIELDS: { field: TrackIdField; label: string; placeholder: string }[] =
  [
    { field: "spotifyId", label: "Spotify", placeholder: "4cOdK2wGLETKBW3PvgPWqT" },
    { field: "appleMusicId", label: "Apple Music", placeholder: "1559523359" },
    { field: "deezerId", label: "Deezer", placeholder: "3135556" },
    { field: "neteaseId", label: "NetEase", placeholder: "5257138" },
    { field: "qqMusicId", label: "QQ Music", placeholder: "0039MnYb0qxYhV" },
    { field: "isrc", label: "ISRC", placeholder: "GBARL9300135" },
  ];

const ANNOTATION_LABELS: Record<AnnotationField, string> = {
  translation: "Translation",
  romaji: "Romaji",
};

// Every row in every column has this height, so a translation dragged one slot
// lines up with the next lyric line
const ROW_HEIGHT = 52;
const rowHeight = { height: ROW_HEIGHT };
// Alternating row shading behind all columns, so rows read across
const rowStripes = {
  backgroundImage: `repeating-linear-gradient(to bottom, transparent 0 ${ROW_HEIGHT}px, rgb(255 255 255 / 0.03) ${ROW_HEIGHT}px ${ROW_HEIGHT * 2}px)`,
};

// 83085 -> "01:23.085"
function formatTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const millis = safe % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

// Accepts "1:23.085", "01:23.08", "83.085" or "83"; null when unreadable
function parseTime(value: string): number | null {
  const match = value.trim().match(/^(?:(\d{1,3}):)?(\d{1,4})(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const minutes = Number(match[1] ?? 0);
  const seconds = Number(match[2]);
  const millis = Number((match[3] ?? "0").padEnd(3, "0"));
  if (match[1] !== undefined && seconds >= 60) return null;
  return minutes * 60000 + seconds * 1000 + millis;
}

function initialIds(track: SanitizedTrack<TrackRecord>) {
  return Object.fromEntries(
    ID_FIELDS.map(({ field }) => [field, track[field] ?? ""]),
  ) as Record<TrackIdField, string>;
}

// ---------- Line column ----------

function TimeInput({
  value,
  onCommit,
  label,
}: {
  value: number;
  onCommit: (ms: number) => void;
  label: string;
}) {
  const [draft, setDraft] = useState(formatTime(value));
  useEffect(() => setDraft(formatTime(value)), [value]);

  const commit = () => {
    const parsed = parseTime(draft);
    if (parsed === null) {
      setDraft(formatTime(value));
      toast.error("Use a time like 01:23.450");
      return;
    }
    if (parsed !== value) onCommit(parsed);
    else setDraft(formatTime(value));
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      aria-label={label}
      inputMode="decimal"
      className="w-[5.75rem] shrink-0 rounded-lg bg-transparent px-1.5 py-1.5 font-mono text-[13px] font-semibold tabular-nums text-white/90 ring-1 ring-transparent transition hover:ring-white/15 focus:bg-white/5 focus:ring-white/30 focus:outline-none sm:w-[6.5rem] sm:px-2 sm:text-sm"
    />
  );
}

interface LineRowProps {
  index: number;
  line: EditableLine;
  offset: number;
  onStart: (index: number, ms: number) => void;
  onText: (index: number, text: string) => void;
  onDuet: (index: number) => void;
  onBg: (index: number) => void;
  onRemove: (index: number) => void;
}

const checkboxClass =
  "size-4 cursor-pointer appearance-none rounded-full ring-2 ring-white/25 transition checked:bg-sky-400 checked:ring-sky-400";

const LineRow = memo(function LineRow({
  index,
  line,
  offset,
  onStart,
  onText,
  onDuet,
  onBg,
  onRemove,
}: LineRowProps) {
  const text = lineText(line);
  const [draft, setDraft] = useState(text);
  useEffect(() => setDraft(text), [text]);

  const commitText = () => {
    if (!draft.trim()) {
      setDraft(text);
      toast.error("A line can't be empty. Delete it instead.");
      return;
    }
    if (draft.trim() !== text) onText(index, draft);
  };

  return (
    <li style={rowHeight} className="flex items-center gap-1 pr-1 sm:gap-2">
      <TimeInput
        value={lineStart(line) + offset}
        onCommit={(ms) => onStart(index, ms - offset)}
        label={`Start time of line ${index + 1}`}
      />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        title={draft}
        aria-label={`Lyrics of line ${index + 1}`}
        className={cn(
          "min-w-0 flex-1 truncate rounded-lg bg-transparent px-2 py-1.5 text-[15px] font-semibold text-white ring-1 ring-transparent transition hover:ring-white/15 focus:bg-white/5 focus:ring-white/30 focus:outline-none",
          line.bg && "text-white/70",
        )}
      />
      <label
        className="flex w-9 shrink-0 cursor-pointer justify-center"
        title="Sung by the second singer (shown on the other side)"
      >
        <input
          type="checkbox"
          checked={line.duet}
          onChange={() => onDuet(index)}
          aria-label={`Line ${index + 1} is a duet part`}
          className={checkboxClass}
        />
      </label>
      <label
        className="flex w-9 shrink-0 cursor-pointer justify-center"
        title="Background vocals (shown smaller, under the main line)"
      >
        <input
          type="checkbox"
          checked={line.bg}
          onChange={() => onBg(index)}
          aria-label={`Line ${index + 1} is background vocals`}
          className={checkboxClass}
        />
      </label>
      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Delete line ${index + 1}`}
        title="Delete line"
        className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/35 transition-colors hover:bg-red-500/15 hover:text-red-300"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
  );
});

// ---------- Translation / romaji columns ----------

function AnnotationChip({
  provided,
  field,
  index,
  value,
  dragging = false,
  onChange,
}: {
  provided: DraggableProvided;
  field: AnnotationField;
  index: number;
  value: string;
  dragging?: boolean;
  onChange?: (index: number, field: AnnotationField, value: string) => void;
}) {
  const label = ANNOTATION_LABELS[field];
  return (
    <div
      ref={provided.innerRef}
      {...provided.draggableProps}
      style={{ ...provided.draggableProps.style, ...rowHeight }}
      className="flex items-center"
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-0.5 rounded-lg py-0.5 pr-1 transition-colors",
          dragging
            ? "bg-zinc-800 shadow-2xl ring-1 ring-sky-300/60"
            : "hover:bg-white/5",
        )}
      >
        <span
          {...provided.dragHandleProps}
          aria-label={`Move the ${label.toLowerCase()} of line ${index + 1}. Press space to pick it up, arrow keys to move it, space to drop it.`}
          title={`Drag to move this ${label.toLowerCase()} to another line`}
          className="flex h-8 w-6 shrink-0 cursor-grab items-center justify-center rounded text-white/30 hover:text-white/70 active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
        <input
          value={value}
          readOnly={!onChange}
          onChange={(e) => onChange?.(index, field, e.target.value)}
          placeholder="—"
          title={value}
          aria-label={`${label} of line ${index + 1}`}
          className={cn(
            "min-w-0 flex-1 truncate rounded-md bg-transparent px-1.5 py-1.5 text-sm text-white/70 placeholder:text-white/15 focus:bg-white/5 focus:text-white focus:outline-none",
            field === "romaji" && "italic",
          )}
        />
      </div>
    </div>
  );
}

const AnnotationColumn = memo(function AnnotationColumn({
  field,
  values,
  className,
  onChange,
}: {
  field: AnnotationField;
  values: string[];
  className?: string;
  onChange: (index: number, field: AnnotationField, value: string) => void;
}) {
  return (
    // The dragged item is position: fixed, so no ancestor of this list may have
    // a transform, filter or backdrop-filter (the dialog uses a solid background)
    <Droppable droppableId={field}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={cn(
            "min-w-0 flex-[2] rounded-lg transition-colors",
            snapshot.isDraggingOver && "bg-sky-400/5",
            className,
          )}
        >
          {values.map((value, index) => (
            // Slots are positional: a move shifts the values, not the slots
            <Draggable key={index} draggableId={`${field}-${index}`} index={index}>
              {(dragProvided, dragSnapshot) => (
                <AnnotationChip
                  provided={dragProvided}
                  field={field}
                  index={index}
                  value={value}
                  dragging={dragSnapshot.isDragging}
                  onChange={onChange}
                />
              )}
            </Draggable>
          ))}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
});

// ---------- Editor ----------

export function LyricsEditor({
  open,
  track,
  lyrics,
  onClose,
  onSaved,
  getTurnstileToken,
}: LyricsEditorProps) {
  const keyRef = useRef(0);
  const toRows = useCallback(
    (payload: SyncedLyricsPayload | null): Row[] =>
      payload
        ? toEditableLines(payload).map((line) => ({
            key: keyRef.current++,
            line,
          }))
        : [],
    [],
  );

  const [tab, setTab] = useState<EditorTab>("lyrics");
  const [rows, setRows] = useState<Row[]>(() => toRows(lyrics));
  const [offset, setOffset] = useState(0);
  const [offsetDraft, setOffsetDraft] = useState("0");
  const [ids, setIds] = useState(() => initialIds(track));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; trackId?: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  // Small screens show one annotation column at a time
  const [mobileColumn, setMobileColumn] = useState<AnnotationField>("translation");

  // Reset to the track's current state every time the editor opens
  useEffect(() => {
    if (!open) return;
    setTab(lyrics ? "lyrics" : "ids");
    setRows(toRows(lyrics));
    setOffset(0);
    setOffsetDraft("0");
    setIds(initialIds(track));
    setError(null);
    setMobileColumn("translation");
  }, [open, lyrics, track, toRows]);

  const original = useMemo(
    () => (lyrics ? JSON.stringify(fromEditableLines(toEditableLines(lyrics))) : ""),
    [lyrics],
  );
  const editedPayload = useMemo(
    () => fromEditableLines(shiftLines(rows.map((r) => r.line), offset)),
    [rows, offset],
  );
  const lyricsChanged = Boolean(lyrics) && JSON.stringify(editedPayload) !== original;
  const idChanges = useMemo(() => {
    const changes: Partial<Record<TrackIdField, string | null>> = {};
    for (const { field } of ID_FIELDS) {
      const next = ids[field].trim();
      if (next !== (track[field] ?? "")) changes[field] = next || null;
    }
    return changes;
  }, [ids, track]);
  const idsChanged = Object.keys(idChanges).length > 0;
  const dirty = lyricsChanged || idsChanged;

  const translations = useMemo(() => rows.map((r) => r.line.translation), [rows]);
  const romaji = useMemo(() => rows.map((r) => r.line.romaji), [rows]);
  const showRomaji = romaji.some(Boolean);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm("Discard your changes?")) return;
    onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape also cancels a keyboard drag; don't close the editor then
      if (e.key === "Escape" && !dragging) requestClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose, dragging]);

  // ----- Row edits (stable callbacks so unchanged rows don't re-render) -----

  const updateLine = useCallback(
    (index: number, update: (line: EditableLine) => EditableLine) =>
      setRows((prev) =>
        prev.map((row, i) => (i === index ? { ...row, line: update(row.line) } : row)),
      ),
    [],
  );
  // A new time that passes a neighbour moves the line into time order, so the
  // saved lyrics never go backwards
  const onStart = useCallback(
    (index: number, ms: number) =>
      setRows((prev) => {
        const row = prev[index];
        if (!row) return prev;
        const moved = { ...row, line: setLineStart(row.line, ms) };
        const start = lineStart(moved.line);
        const before = prev[index - 1];
        const after = prev[index + 1];
        const inOrder =
          (!before || lineStart(before.line) <= start) &&
          (!after || start <= lineStart(after.line));
        if (inOrder) return prev.map((r, i) => (i === index ? moved : r));

        const rest = prev.filter((_, i) => i !== index);
        const at = rest.findIndex((r) => lineStart(r.line) > start);
        rest.splice(at === -1 ? rest.length : at, 0, moved);
        return rest;
      }),
    [],
  );
  const lineSynced = track.lyricsType === "line";
  const onText = useCallback(
    (index: number, text: string) =>
      updateLine(index, (l) => setLineText(l, text, { lineSynced })),
    [updateLine, lineSynced],
  );
  const onAnnotation = useCallback(
    (index: number, field: AnnotationField, value: string) =>
      updateLine(index, (l) => ({ ...l, [field]: value })),
    [updateLine],
  );
  const onDuet = useCallback(
    (index: number) => updateLine(index, (l) => ({ ...l, duet: !l.duet })),
    [updateLine],
  );
  const onBg = useCallback(
    (index: number) => updateLine(index, (l) => ({ ...l, bg: !l.bg })),
    [updateLine],
  );
  const onRemove = useCallback(
    (index: number) => setRows((prev) => prev.filter((_, i) => i !== index)),
    [],
  );

  const handleDragEnd = (result: DropResult) => {
    setDragging(false);
    const { source, destination } = result;
    if (!destination || destination.droppableId !== source.droppableId) return;
    if (destination.index === source.index) return;
    const field = source.droppableId as AnnotationField;
    setRows((prev) => {
      const moved = moveAnnotation(
        prev.map((r) => r.line),
        field,
        source.index,
        destination.index,
      );
      return prev.map((row, i) => ({ ...row, line: moved[i]! }));
    });
  };

  const commitOffset = () => {
    const parsed = Number(offsetDraft.trim() || "0");
    if (!Number.isFinite(parsed)) {
      setOffsetDraft(String(offset));
      return;
    }
    setOffset(Math.round(parsed));
    setOffsetDraft(String(Math.round(parsed)));
  };

  const handleSave = async () => {
    if (!dirty || saving) return;
    if (rows.length === 0) {
      toast.error("Lyrics can't be empty. Keep at least one line.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const edit: TrackEdit = {
        baseUpdatedAt: new Date(track.updatedAt).toISOString(),
        ...(lyricsChanged ? { lyrics: editedPayload } : {}),
        ...(idsChanged ? { ids: idChanges } : {}),
      };
      const token = await getTurnstileToken("edit-track");
      const updated = await editTrack(track.id, edit, token);
      onSaved(updated, lyricsChanged ? editedPayload : lyrics);
      toast.success("Thanks! Your edit is live.");
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to save your edit.";
      setError({
        message,
        trackId: err instanceof TrackEditError ? err.trackId : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  // Which annotation columns show on small screens (all show from `sm` up)
  const columnVisibility = (field: AnnotationField) =>
    showRomaji && mobileColumn !== field ? "hidden sm:block" : "";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fade}
            onClick={requestClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          <motion.div
            key="editor"
            role="dialog"
            aria-modal="true"
            aria-label="Edit lyrics"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 40 }}
            transition={spring.soft}
            // Solid background, no backdrop-filter: the drag-and-drop lists
            // need fixed positioning relative to the viewport
            className="relative flex h-[94dvh] w-full max-w-6xl flex-col overflow-hidden rounded-t-[28px] bg-zinc-900 text-white shadow-2xl ring-1 ring-white/10 sm:h-[88dvh] sm:rounded-[28px]"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-3 border-b border-white/10 px-4 pt-4 pb-3 sm:px-6">
              <div className="min-w-0">
                <h2 className="text-lg font-bold tracking-tight">Edit lyrics</h2>
                <p className="truncate text-xs text-white/55">
                  {track.title} · {track.artists?.join(", ")}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <motion.button
                  type="button"
                  whileTap={press}
                  transition={spring.snappy}
                  onClick={handleSave}
                  disabled={!dirty || saving}
                  className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-40 cursor-pointer"
                >
                  {saving && <Loader2 className="size-4 animate-spin" />}
                  {saving ? "Saving…" : "Save"}
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={press}
                  transition={spring.snappy}
                  onClick={requestClose}
                  aria-label="Close editor"
                  className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white/70 transition-colors hover:bg-white/20 hover:text-white cursor-pointer"
                >
                  <X className="size-4" />
                </motion.button>
              </div>
            </div>

            {/* Tabs and toolbar */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
              <div
                role="tablist"
                aria-label="Editor section"
                className="flex gap-1 rounded-2xl bg-white/5 p-1 ring-1 ring-white/10"
              >
                {(
                  [
                    ["lyrics", "Lyrics", !lyrics],
                    ["ids", "Platform IDs", false],
                  ] as const
                ).map(([key, label, disabled]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={tab === key}
                    disabled={disabled}
                    onClick={() => setTab(key)}
                    className={cn(
                      "rounded-xl px-3.5 py-1.5 text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-40",
                      tab === key
                        ? "bg-white/15 text-white"
                        : "text-white/55 hover:text-white",
                    )}
                  >
                    {label}
                    {key === "ids" && idsChanged && (
                      <span className="ml-1.5 inline-block size-1.5 rounded-full bg-sky-400 align-middle" />
                    )}
                  </button>
                ))}
              </div>

              {tab === "lyrics" && (
                <label className="flex items-center gap-2 text-sm">
                  <span className="font-semibold">Offset</span>
                  <input
                    value={offsetDraft}
                    onChange={(e) => setOffsetDraft(e.target.value)}
                    onBlur={commitOffset}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    inputMode="numeric"
                    aria-describedby="offset-hint"
                    className="w-20 rounded-lg bg-white/5 px-2.5 py-1.5 font-mono text-sm tabular-nums ring-1 ring-white/10 focus:ring-white/30 focus:outline-none"
                  />
                  <span id="offset-hint" className="text-xs text-white/45">
                    ms · positive = later
                  </span>
                </label>
              )}

              {tab === "lyrics" && showRomaji && (
                <div
                  role="radiogroup"
                  aria-label="Column to show"
                  className="flex gap-1 rounded-xl bg-white/5 p-0.5 ring-1 ring-white/10 sm:hidden"
                >
                  {(["translation", "romaji"] as const).map((field) => (
                    <button
                      key={field}
                      type="button"
                      role="radio"
                      aria-checked={mobileColumn === field}
                      onClick={() => setMobileColumn(field)}
                      className={cn(
                        "rounded-lg px-2.5 py-1 text-xs font-medium",
                        mobileColumn === field
                          ? "bg-white/15 text-white"
                          : "text-white/55",
                      )}
                    >
                      {ANNOTATION_LABELS[field]}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {error && (
              <div
                role="alert"
                className="mx-4 mb-2 rounded-xl bg-red-500/15 px-3.5 py-2.5 text-sm text-red-200 ring-1 ring-red-400/25 sm:mx-6"
              >
                {error.message}{" "}
                {error.trackId && (
                  <Link
                    href={`/track/${error.trackId}`}
                    className="font-semibold underline underline-offset-2"
                  >
                    Open that track
                  </Link>
                )}
              </div>
            )}

            {/* Body */}
            {tab === "lyrics" ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="flex gap-2 border-y border-white/10 px-3 py-2 text-xs font-semibold text-white/50 sm:px-5">
                  <div className="flex min-w-0 flex-[3] gap-1 sm:gap-2">
                    <span className="w-[5.75rem] px-1.5 sm:w-[6.5rem] sm:px-2">Time</span>
                    <span className="flex-1 px-2">Lyrics</span>
                    <span className="w-9 text-center">Duet</span>
                    <span className="w-9 text-center">BG</span>
                    <span className="w-8" />
                  </div>
                  <span className={cn("min-w-0 flex-[2] pl-7", columnVisibility("translation"))}>
                    Translation
                  </span>
                  {showRomaji && (
                    <span className={cn("min-w-0 flex-[2] pl-7", columnVisibility("romaji"))}>
                      Romaji
                    </span>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6 sm:px-5">
                  {rows.length === 0 ? (
                    <p className="py-16 text-center text-sm text-white/50">
                      Every line was deleted. Close the editor to start over.
                    </p>
                  ) : (
                    <DragDropContext
                      onDragStart={() => setDragging(true)}
                      onDragEnd={handleDragEnd}
                    >
                      <div className="flex gap-2" style={rowStripes}>
                        <ol className="min-w-0 flex-[3]">
                          {rows.map((row, index) => (
                            <LineRow
                              key={row.key}
                              index={index}
                              line={row.line}
                              offset={offset}
                              onStart={onStart}
                              onText={onText}
                              onDuet={onDuet}
                              onBg={onBg}
                              onRemove={onRemove}
                            />
                          ))}
                        </ol>
                        <AnnotationColumn
                          field="translation"
                          values={translations}
                          className={columnVisibility("translation")}
                          onChange={onAnnotation}
                        />
                        {showRomaji && (
                          <AnnotationColumn
                            field="romaji"
                            values={romaji}
                            className={columnVisibility("romaji")}
                            onChange={onAnnotation}
                          />
                        )}
                      </div>
                    </DragDropContext>
                  )}
                </div>
                <p className="border-t border-white/10 px-4 py-2.5 text-xs text-white/45 sm:px-6">
                  Drag a translation or romaji by its handle to the line it
                  belongs to. The ones in between shift by one line, so a drift
                  is fixed in one move.
                </p>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 sm:px-6">
                <p className="mb-4 max-w-2xl text-sm text-white/60">
                  Fix these if LyricsDB matched the wrong song on a platform.
                  When you change or clear an ID, the old one is remembered as a
                  wrong match and won&apos;t be linked to this track again.
                </p>
                <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
                  {ID_FIELDS.map(({ field, label, placeholder }) => {
                    const changed = field in idChanges;
                    return (
                      <label key={field} className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-2 text-xs font-semibold text-white/70">
                          {label}
                          {changed && (
                            <span className="rounded bg-sky-400/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                              {ids[field].trim() ? "changed" : "will be removed"}
                            </span>
                          )}
                        </span>
                        <input
                          value={ids[field]}
                          onChange={(e) =>
                            setIds((prev) => ({ ...prev, [field]: e.target.value }))
                          }
                          placeholder={placeholder}
                          spellCheck={false}
                          autoComplete="off"
                          className={cn(
                            "rounded-xl bg-white/5 px-3 py-2 font-mono text-sm ring-1 ring-white/10 placeholder:text-white/20 focus:ring-white/30 focus:outline-none",
                            changed && "ring-sky-400/40",
                          )}
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

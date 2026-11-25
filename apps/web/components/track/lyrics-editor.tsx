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
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Loader2,
  Trash2,
  X,
} from "lucide-react";
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

// Drops on the line under the pointer; keyboard drags (no pointer) use the nearest
const lineUnderPointer: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  return hits.length > 0 ? hits : closestCenter(args);
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

// ---------- Rows ----------

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
      className="w-[6.5rem] rounded-lg bg-transparent px-2 py-1.5 font-mono text-sm font-semibold tabular-nums text-white/90 ring-1 ring-transparent transition hover:ring-white/15 focus:bg-white/5 focus:ring-white/30 focus:outline-none"
    />
  );
}

function AnnotationChip({
  index,
  field,
  value,
  lineCount,
  onChange,
  onMove,
}: {
  index: number;
  field: AnnotationField;
  value: string;
  lineCount: number;
  onChange: (index: number, field: AnnotationField, value: string) => void;
  onMove: (field: AnnotationField, from: number, to: number) => void;
}) {
  const id = `${field}:${index}`;
  const drag = useDraggable({ id, data: { field, index } });
  const drop = useDroppable({ id, data: { field, index } });
  const label = ANNOTATION_LABELS[field];

  return (
    <div
      ref={drop.setNodeRef}
      className={cn(
        "group/chip flex items-center gap-1 rounded-lg transition-colors",
        drop.isOver && !drag.isDragging && "bg-sky-400/15 ring-1 ring-sky-300/50",
        drag.isDragging && "opacity-30",
      )}
    >
      <button
        ref={drag.setNodeRef}
        type="button"
        {...drag.listeners}
        {...drag.attributes}
        aria-label={`Drag ${label.toLowerCase()} of line ${index + 1} to another line`}
        title={`Drag to move this ${label.toLowerCase()} to another line`}
        className="flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded text-white/30 hover:text-white/70 active:cursor-grabbing"
      >
        <GripVertical className="size-3.5" />
      </button>
      <input
        value={value}
        onChange={(e) => onChange(index, field, e.target.value)}
        placeholder={label}
        aria-label={`${label} of line ${index + 1}`}
        className={cn(
          "min-w-0 flex-1 rounded-md bg-transparent px-1.5 py-0.5 text-xs text-white/60 placeholder:text-white/20 focus:bg-white/5 focus:text-white/85 focus:outline-none",
          field === "romaji" && "italic",
        )}
      />
      <div className="flex shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-100 group-focus-within/chip:opacity-100">
        <button
          type="button"
          disabled={index === 0}
          onClick={() => onMove(field, index, index - 1)}
          aria-label={`Move ${label.toLowerCase()} of line ${index + 1} up`}
          className="flex size-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowUp className="size-3.5" />
        </button>
        <button
          type="button"
          disabled={index === lineCount - 1}
          onClick={() => onMove(field, index, index + 1)}
          aria-label={`Move ${label.toLowerCase()} of line ${index + 1} down`}
          className="flex size-6 items-center justify-center rounded text-white/40 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
        >
          <ArrowDown className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

interface LineRowProps {
  index: number;
  line: EditableLine;
  offset: number;
  lineCount: number;
  showRomaji: boolean;
  onStart: (index: number, ms: number) => void;
  onText: (index: number, text: string) => void;
  onAnnotation: (index: number, field: AnnotationField, value: string) => void;
  onMove: (field: AnnotationField, from: number, to: number) => void;
  onDuet: (index: number) => void;
  onRemove: (index: number) => void;
}

const LineRow = memo(function LineRow({
  index,
  line,
  offset,
  lineCount,
  showRomaji,
  onStart,
  onText,
  onAnnotation,
  onMove,
  onDuet,
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
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1 border-b border-white/5 px-2 py-2 sm:grid-cols-[auto_minmax(0,1fr)_auto_auto] sm:px-3">
      <TimeInput
        value={lineStart(line) + offset}
        onCommit={(ms) => onStart(index, ms - offset)}
        label={`Start time of line ${index + 1}`}
      />

      <div className="col-span-2 row-start-2 flex min-w-0 flex-col gap-0.5 sm:col-span-1 sm:row-start-auto">
        <div className="flex min-w-0 items-center gap-1.5">
          {line.bg && (
            <span
              title="Background vocals"
              className="shrink-0 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white/55 uppercase"
            >
              BG
            </span>
          )}
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitText}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            aria-label={`Lyrics of line ${index + 1}`}
            className={cn(
              "min-w-0 flex-1 rounded-lg bg-transparent px-2 py-1 text-[15px] font-semibold text-white ring-1 ring-transparent transition hover:ring-white/15 focus:bg-white/5 focus:ring-white/30 focus:outline-none",
              line.bg && "text-white/70",
            )}
          />
        </div>
        <AnnotationChip
          index={index}
          field="translation"
          value={line.translation}
          lineCount={lineCount}
          onChange={onAnnotation}
          onMove={onMove}
        />
        {showRomaji && (
          <AnnotationChip
            index={index}
            field="romaji"
            value={line.romaji}
            lineCount={lineCount}
            onChange={onAnnotation}
            onMove={onMove}
          />
        )}
      </div>

      <label
        className="col-start-2 row-start-1 flex cursor-pointer items-center justify-end gap-1.5 self-center text-xs text-white/50 sm:col-start-auto sm:row-start-auto sm:w-14 sm:justify-center"
        title="Sung by the second singer (shown on the other side)"
      >
        <input
          type="checkbox"
          checked={line.duet}
          onChange={() => onDuet(index)}
          aria-label={`Line ${index + 1} is a duet part`}
          className="size-4 cursor-pointer appearance-none rounded-full ring-2 ring-white/25 transition checked:bg-sky-400 checked:ring-sky-400"
        />
        <span className="sm:hidden">Duet</span>
      </label>

      <button
        type="button"
        onClick={() => onRemove(index)}
        aria-label={`Delete line ${index + 1}`}
        title="Delete line"
        className="col-start-3 row-start-1 flex size-8 items-center justify-center self-center rounded-full text-white/35 transition-colors hover:bg-red-500/15 hover:text-red-300 sm:col-start-auto sm:row-start-auto"
      >
        <Trash2 className="size-4" />
      </button>
    </li>
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
  const [dragging, setDragging] = useState<{ field: AnnotationField; value: string } | null>(null);

  // Reset to the track's current state every time the editor opens
  useEffect(() => {
    if (!open) return;
    setTab(lyrics ? "lyrics" : "ids");
    setRows(toRows(lyrics));
    setOffset(0);
    setOffsetDraft("0");
    setIds(initialIds(track));
    setError(null);
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
  const showRomaji = rows.some((r) => r.line.romaji);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (dirty && !window.confirm("Discard your changes?")) return;
    onClose();
  }, [dirty, onClose, saving]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
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
  const onRemove = useCallback(
    (index: number) => setRows((prev) => prev.filter((_, i) => i !== index)),
    [],
  );
  const onMove = useCallback(
    (field: AnnotationField, from: number, to: number) =>
      setRows((prev) => {
        const moved = moveAnnotation(
          prev.map((r) => r.line),
          field,
          from,
          to,
        );
        return prev.map((row, i) => ({ ...row, line: moved[i]! }));
      }),
    [],
  );

  // ----- Drag and drop of translations / romaji -----

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );
  const handleDragStart = (event: DragStartEvent) => {
    const data = event.active.data.current as
      | { field: AnnotationField; index: number }
      | undefined;
    if (!data) return;
    setDragging({
      field: data.field,
      value: rows[data.index]?.line[data.field] ?? "",
    });
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null);
    const from = event.active.data.current as
      | { field: AnnotationField; index: number }
      | undefined;
    const to = event.over?.data.current as
      | { field: AnnotationField; index: number }
      | undefined;
    if (!from || !to || from.field !== to.field) return;
    onMove(from.field, from.index, to.index);
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
    if (
      track.isVerified &&
      !window.confirm("Saving removes this track's Verified badge until someone confirms it again. Save anyway?")
    ) {
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
            className="relative flex h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-[28px] bg-zinc-900/90 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur-2xl sm:h-[88dvh] sm:rounded-[28px]"
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
            <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
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
                    className="w-24 rounded-lg bg-white/5 px-2.5 py-1.5 font-mono text-sm tabular-nums ring-1 ring-white/10 focus:ring-white/30 focus:outline-none"
                  />
                  <span id="offset-hint" className="text-xs text-white/45">
                    ms · positive = later
                  </span>
                </label>
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
                <div className="hidden grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-2 border-y border-white/10 px-3 py-2 text-xs font-semibold text-white/50 sm:mx-3 sm:grid">
                  <span className="w-[6.5rem] px-2">Time</span>
                  <span className="px-2">Lyrics · translation · romaji</span>
                  <span className="w-14 text-center">Duet</span>
                  <span className="w-8" />
                </div>
                <DndContext
                  sensors={sensors}
                  collisionDetection={lineUnderPointer}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setDragging(null)}
                >
                  <ol className="min-h-0 flex-1 overflow-y-auto px-1 pb-6 sm:px-3">
                    {rows.map((row, index) => (
                      <LineRow
                        key={row.key}
                        index={index}
                        line={row.line}
                        offset={offset}
                        lineCount={rows.length}
                        showRomaji={showRomaji}
                        onStart={onStart}
                        onText={onText}
                        onAnnotation={onAnnotation}
                        onMove={onMove}
                        onDuet={onDuet}
                        onRemove={onRemove}
                      />
                    ))}
                    {rows.length === 0 && (
                      <li className="py-16 text-center text-sm text-white/50">
                        Every line was deleted. Close the editor to start over.
                      </li>
                    )}
                  </ol>
                  <DragOverlay dropAnimation={null}>
                    {dragging && (
                      <div className="max-w-xs truncate rounded-lg bg-sky-400/90 px-2.5 py-1 text-xs font-medium text-black shadow-xl">
                        {dragging.value || `(empty ${ANNOTATION_LABELS[dragging.field].toLowerCase()})`}
                      </div>
                    )}
                  </DragOverlay>
                </DndContext>
                <p className="border-t border-white/10 px-4 py-2.5 text-xs text-white/45 sm:px-6">
                  Drag a translation or romaji by its handle onto another line.
                  The ones in between shift by one line, so a drift is fixed in
                  one move.
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

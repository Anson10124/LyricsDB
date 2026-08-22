"use client";

import { useMemo, useState } from "react";
import { Check, Copy, Download, FileCode, WrapText } from "lucide-react";
import type { SanitizedTrack, TrackRecord } from "@repo/types";
import type { LyricsViewFormat } from "@/lib/lyrics-formatter";

interface LyricsCodeViewerProps {
  format: LyricsViewFormat;
  code: string;
  track?: SanitizedTrack<TrackRecord>;
  className?: string;
}

interface Token {
  type:
    | "whitespace"
    | "tag"
    | "bracket"
    | "attr-name"
    | "attr-value"
    | "operator"
    | "lyric-text"
    | "string"
    | "number"
    | "keyword"
    | "punctuation"
    | "comment"
    | "text";
  text: string;
}

function tokenizeXmlLine(line: string): Token[] {
  const tokens: Token[] = [];
  const indentMatch = line.match(/^(\s+)/);
  let remaining = line;

  if (indentMatch) {
    tokens.push({ type: "whitespace", text: indentMatch[1]! });
    remaining = remaining.slice(indentMatch[1]!.length);
  }

  const xmlTokenRegex =
    /(<!--[\s\S]*?-->|<\?[^>]*\?>|<\/([a-zA-Z0-9_:-]+)>|<([a-zA-Z0-9_:-]+)((?:\s+[a-zA-Z0-9_:-]+(?:=(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?>)|([^<]+))/g;
  let match: RegExpExecArray | null;

  while ((match = xmlTokenRegex.exec(remaining)) !== null) {
    const full = match[0];
    if (full.startsWith("<!--") || full.startsWith("<?")) {
      tokens.push({ type: "comment", text: full });
    } else if (match[2]) {
      // Closing tag </tag>
      tokens.push({ type: "bracket", text: "</" });
      tokens.push({ type: "tag", text: match[2] });
      tokens.push({ type: "bracket", text: ">" });
    } else if (match[3]) {
      // Opening or self-closing tag <tag ... /?>
      const tagName = match[3];
      const rawAttrs = match[4] || "";
      const closingBracket = match[5] || ">";

      tokens.push({ type: "bracket", text: "<" });
      tokens.push({ type: "tag", text: tagName });

      if (rawAttrs.trim()) {
        const attrRegex = /([a-zA-Z0-9_:-]+)(?:=("[^"]*"|'[^']*'|[^\s>]+))?/g;
        let attrMatch: RegExpExecArray | null;
        let lastIdx = 0;
        while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
          const preWhitespace = rawAttrs.slice(lastIdx, attrMatch.index);
          if (preWhitespace)
            tokens.push({ type: "whitespace", text: preWhitespace });

          tokens.push({ type: "attr-name", text: attrMatch[1]! });
          if (attrMatch[2] !== undefined) {
            tokens.push({ type: "operator", text: "=" });
            tokens.push({ type: "attr-value", text: attrMatch[2] });
          }
          lastIdx = attrRegex.lastIndex;
        }
      }

      tokens.push({ type: "bracket", text: closingBracket });
    } else if (match[6]) {
      // Text node
      tokens.push({ type: "lyric-text", text: match[6] });
    }
  }

  return tokens.length > 0 ? tokens : [{ type: "text", text: line }];
}

function tokenizeJsonLine(line: string): Token[] {
  const tokens: Token[] = [];
  const jsonRegex =
    /(\s+)|("(?:\\.|[^"\\])*")|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}[\]:,])|([^"\d{}[],:\s]+)/g;
  let match: RegExpExecArray | null;


  while ((match = jsonRegex.exec(line)) !== null) {
    if (match[1]) tokens.push({ type: "whitespace", text: match[1] });
    else if (match[2]) {
      const rest = line.slice(jsonRegex.lastIndex).trim();
      if (rest.startsWith(":")) {
        tokens.push({ type: "attr-name", text: match[2] });
      } else {
        tokens.push({ type: "string", text: match[2] });
      }
    } else if (match[3]) tokens.push({ type: "number", text: match[3] });
    else if (match[4]) tokens.push({ type: "keyword", text: match[4] });
    else if (match[5]) tokens.push({ type: "punctuation", text: match[5] });
    else if (match[6]) tokens.push({ type: "text", text: match[6] });
  }

  return tokens.length > 0 ? tokens : [{ type: "text", text: line }];
}

function renderToken(token: Token, idx: number) {
  switch (token.type) {
    case "whitespace":
      return <span key={idx}>{token.text}</span>;
    case "tag":
      return (
        <span key={idx} className="text-sky-400 font-semibold">
          {token.text}
        </span>
      );
    case "bracket":
      return (
        <span key={idx} className="text-zinc-500">
          {token.text}
        </span>
      );
    case "attr-name":
      return (
        <span key={idx} className="text-violet-400 font-medium">
          {token.text}
        </span>
      );
    case "attr-value":
    case "string":
      return (
        <span key={idx} className="text-emerald-400">
          {token.text}
        </span>
      );
    case "operator":
    case "punctuation":
      return (
        <span key={idx} className="text-zinc-500">
          {token.text}
        </span>
      );
    case "lyric-text":
      return (
        <span key={idx} className="text-zinc-100 font-medium">
          {token.text}
        </span>
      );
    case "number":
      return (
        <span key={idx} className="text-amber-400 font-mono font-medium">
          {token.text}
        </span>
      );
    case "keyword":
      return (
        <span key={idx} className="text-pink-400 font-semibold">
          {token.text}
        </span>
      );
    case "comment":
      return (
        <span key={idx} className="text-zinc-500 italic">
          {token.text}
        </span>
      );
    case "text":
    default:
      return (
        <span key={idx} className="text-zinc-200">
          {token.text}
        </span>
      );
  }
}

export function LyricsCodeViewer({
  format,
  code,
  track,
  className,
}: LyricsCodeViewerProps) {
  const [copied, setCopied] = useState(false);
  const [wrapLines, setWrapLines] = useState(false);

  const lines = useMemo(() => code.split(/\r\n|\r|\n/), [code]);

  const tokenizedLines = useMemo(() => {
    switch (format) {
      case "ttml":
        return lines.map((line) => tokenizeXmlLine(line));
      case "json":
      case "metadata":
        return lines.map((line) => tokenizeJsonLine(line));
      default:
        return lines.map((line) => [{ type: "text" as const, text: line }]);
    }
  }, [format, lines]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write fallback
    }
  };

  const handleDownload = () => {
    const extMap: Record<string, string> = {
      ttml: "ttml",
      json: "json",
      metadata: "metadata.json",
      eslrc: "lrc",
      lrc: "lrc",
      ass: "ass",
      qrc: "qrc",
    };
    const extension = extMap[format] || "txt";
    const title = track?.title || "lyrics";
    const artist = track?.artists?.join(", ") || "";
    const filename = artist
      ? `${title} - ${artist}.${extension}`
      : `${title}.${extension}`;

    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatLabel = useMemo(() => {
    switch (format) {
      case "ttml":
        return "TTML (XML)";
      case "eslrc":
        return "Enhanced LRC (ESLRC)";
      case "lrc":
        return "LRC (Timed)";
      case "json":
        return "JSON (Raw Lyrics)";
      case "metadata":
        return "JSON (Track Metadata)";
      case "ass":
        return "ASS (SubStation)";
      case "qrc":
        return "QRC";
      default:
        return format.toUpperCase();
    }
  }, [format]);

  return (
    <div
      className={`group relative flex h-[520px] w-full flex-col rounded-2xl border border-border/70 bg-zinc-950/90 text-zinc-100 shadow-xl backdrop-blur-md overflow-hidden ${
        className || ""
      }`}
    >
      {/* Top Header Bar */}
      <div className="flex shrink-0 items-center justify-between border-b border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 rounded-lg bg-white/10 px-2 py-1 font-mono text-[11px] font-semibold text-primary">
            <FileCode className="size-3.5" />
            <span>{formatLabel}</span>
          </div>

          <span className="hidden sm:inline-block text-[11px] text-zinc-400 font-medium tabular-nums">
            {lines.length} {lines.length === 1 ? "line " : "lines "}
            <span className="hidden md:inline-block text-[11px] text-zinc-500 tabular-nums">
              • {code.length.toLocaleString()} chars
            </span>
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setWrapLines((w) => !w)}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium transition-colors cursor-pointer ${
              wrapLines
                ? "bg-primary/20 text-primary border border-primary/30"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
            }`}
            title="Toggle word wrap"
          >
            <WrapText className="size-3.5" />
            <span className="hidden sm:inline">
              {wrapLines ? "Wrap On" : "Wrap Off"}
            </span>
          </button>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            title="Copy lyrics"
          >
            {copied ? (
              <>
                <Check className="size-3.5 text-emerald-400" />
                <span className="text-emerald-400 font-medium">Copied</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white transition-colors cursor-pointer"
            title="Download lyrics file"
          >
            <Download className="size-3.5" />
            <span>Download</span>
          </button>
        </div>
      </div>

      {/* Code Container */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto p-4 font-mono text-xs leading-relaxed select-text scrollbar-thin">
        <table className="w-full border-collapse">
          <tbody>
            {tokenizedLines.map((tokens, lineIdx) => (
              <tr
                key={lineIdx}
                className="hover:bg-white/[0.04] transition-colors rounded-sm group/line"
              >
                {/* Line numbers gutter */}
                <td
                  className="select-none text-right pr-4 text-zinc-600 group-hover/line:text-zinc-400 font-mono text-[11px] tabular-nums align-top w-[40px] shrink-0"
                  aria-hidden="true"
                >
                  {lineIdx + 1}
                </td>

                {/* Code line content */}
                <td
                  className={`align-top pl-2 ${
                    wrapLines
                      ? "whitespace-pre-wrap break-all"
                      : "whitespace-pre"
                  }`}
                >
                  {tokens.map((token, tokenIdx) =>
                    renderToken(token, tokenIdx),
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

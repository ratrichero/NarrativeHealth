"use client";

// CHAT-P3.5: Tiny markdown renderer for chat answers — bold, inline code,
// bullets, headings. No dependency: bot output is a constrained subset
// (system prompt requires short bullets), so a full parser is unnecessary.

import { Fragment, type ReactNode } from "react";

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Split on **bold** and `code`
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const parts = text.split(regex);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.startsWith("**") && part.endsWith("**")) {
      nodes.push(
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    } else if (part.startsWith("`") && part.endsWith("`")) {
      nodes.push(
        <code key={i} className="bg-slate-800 text-cyan-300 rounded px-1 py-0.5 text-[12px] font-mono">
          {part.slice(1, -1)}
        </code>
      );
    } else if (part) {
      nodes.push(<Fragment key={i}>{part}</Fragment>);
    }
  }
  return nodes;
}

export function ChatMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let bulletBuf: string[] = [];

  const flushBullets = (key: string) => {
    if (bulletBuf.length === 0) return;
    blocks.push(
      <ul key={key} className="list-disc pl-4 space-y-0.5 my-1">
        {bulletBuf.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>
    );
    bulletBuf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^[-•*]\s+/.test(trimmed)) {
      bulletBuf.push(trimmed.replace(/^[-•*]\s+/, ""));
      continue;
    }
    flushBullets(`ul-${i}`);

    if (/^#{1,4}\s+/.test(trimmed)) {
      blocks.push(
        <div key={i} className="font-semibold text-white mt-1.5 mb-0.5 text-[13px]">
          {renderInline(trimmed.replace(/^#{1,4}\s+/, ""))}
        </div>
      );
    } else if (trimmed === "") {
      // paragraph break — skip, spacing handled by blocks
    } else {
      blocks.push(
        <p key={i} className="my-0.5">
          {renderInline(trimmed)}
        </p>
      );
    }
  }
  flushBullets("ul-end");

  return <div className="text-sm leading-relaxed">{blocks}</div>;
}

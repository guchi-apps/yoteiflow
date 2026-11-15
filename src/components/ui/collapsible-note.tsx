"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * 詳細画面のメモ欄の開閉枠（issue #1581）。
 *
 * メモが長いと詳細ダイアログが縦に伸び、タイトル・日時が画面外へ出る。既定は約2行ぶんの高さで切り、
 * 開くと最大高の枠の中でスクロールする。閉じた状態を `line-clamp` ではなく `max-h` + `overflow-hidden`
 * にしているのは、中身が複数ブロック（移動メモの途中駅行など）でも効かせるため。
 * 2行に収まるメモは見出し・ボタンを出さず従来どおりそのまま描く。
 */
const CLOSED_MAX_HEIGHT = "max-h-[2.75rem]";

export function CollapsibleNote({
  children,
  defaultOpen = false,
  className,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [overflowing, setOverflowing] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  // 閉じた状態の枠で切れているかを測る。開いている間は直前の結果を保つ（ボタンが消えて閉じられなくなるのを防ぐ）。
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      if (!open) setOverflowing(el.scrollHeight > el.clientHeight + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [open, children]);

  const collapsible = overflowing || open;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      {collapsible && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex items-center justify-between rounded-xs text-left text-xs font-bold text-primary focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span>メモ</span>
          <span className="flex items-center gap-0.5">
            {open ? "閉じる" : "開く"}
            {open ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        </button>
      )}
      <div
        ref={bodyRef}
        className={cn("min-w-0", open ? "max-h-[30dvh] overflow-y-auto" : cn(CLOSED_MAX_HEIGHT, "overflow-hidden"))}
      >
        {children}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  isLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const EXIT_ANIMATION_MS = 260;

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Удалить",
  cancelLabel = "Отмена",
  isLoading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [isMounted, setIsMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setIsMounted(true);
      const frame = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => window.cancelAnimationFrame(frame);
    }

    setIsVisible(false);
    const timeout = window.setTimeout(() => {
      setIsMounted(false);
    }, EXIT_ANIMATION_MS);

    return () => window.clearTimeout(timeout);
  }, [open]);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isLoading) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isLoading, isMounted, onCancel]);

  if (!isMounted) {
    return null;
  }

  return (
    <div
      className={clsx(
        "fixed inset-0 z-[120] flex items-center justify-center px-4 py-6 backdrop-blur-[4px] transition-all duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        isVisible ? "bg-black/48 opacity-100" : "bg-black/0 opacity-0",
      )}
      onClick={() => {
        if (!isLoading) {
          onCancel();
        }
      }}
      data-testid="confirm-dialog"
      aria-hidden={!isVisible}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className={clsx(
          "w-full max-w-[420px] rounded-[22px] border border-white/10 bg-[#13171f] px-5 py-5 text-white shadow-[0_28px_85px_rgba(0,0,0,0.34)] transition-all duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none sm:px-6 sm:py-6",
          isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0",
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <h3
          id="confirm-dialog-title"
          className="text-[1.05rem] font-semibold tracking-tight text-white"
        >
          {title}
        </h3>

        {description ? (
          <p className="mt-3 text-sm leading-6 text-white/72">{description}</p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isLoading}
            data-testid="confirm-dialog-cancel"
            className="rounded-full border border-white/12 px-4 py-2 text-sm font-medium text-white/72 transition hover:border-white/22 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isLoading}
            data-testid="confirm-dialog-confirm"
            className={clsx(
              "min-w-[120px] rounded-full px-5 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60",
              "bg-[#63a4ff] text-white hover:bg-[#5199fb]",
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

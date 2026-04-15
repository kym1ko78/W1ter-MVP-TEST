"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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

type DeleteMessageDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  isLoading?: boolean;
  allowDeleteForEveryone?: boolean;
  onDeleteForSelf: () => void;
  onDeleteForEveryone: () => void;
  onCancel: () => void;
};

const EXIT_ANIMATION_MS = 260;

function useDialogTransition(open: boolean) {
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

  return { isMounted, isVisible };
}

function DialogPortal({
  isMounted,
  children,
}: {
  isMounted: boolean;
  children: React.ReactNode;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalTarget(document.body);
  }, []);

  useEffect(() => {
    if (!isMounted) {
      return;
    }

    const previousBodyOverflow = document.body.style.overflow;
    const previousHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [isMounted]);

  if (!isMounted || !portalTarget) {
    return null;
  }

  return createPortal(children, portalTarget);
}

function DialogOverlay({
  isVisible,
  onClose,
  isLoading,
  children,
}: {
  isVisible: boolean;
  onClose: () => void;
  isLoading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={clsx(
        "fixed inset-0 z-[300] flex items-center justify-center px-4 py-6 backdrop-blur-[5px] transition-all duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        isVisible ? "bg-black/52 opacity-100" : "bg-black/0 opacity-0",
      )}
      onClick={() => {
        if (!isLoading) {
          onClose();
        }
      }}
      aria-hidden={!isVisible}
    >
      {children}
    </div>
  );
}

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
  const { isMounted, isVisible } = useDialogTransition(open);

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

  return (
    <DialogPortal isMounted={isMounted}>
      <DialogOverlay isVisible={isVisible} onClose={onCancel} isLoading={isLoading}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          data-testid="confirm-dialog"
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
              className="min-w-[120px] rounded-full bg-[#63a4ff] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#5199fb] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </DialogOverlay>
    </DialogPortal>
  );
}

export function DeleteMessageDialog({
  open,
  title,
  description,
  isLoading = false,
  allowDeleteForEveryone = true,
  onDeleteForSelf,
  onDeleteForEveryone,
  onCancel,
}: DeleteMessageDialogProps) {
  const { isMounted, isVisible } = useDialogTransition(open);

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

  return (
    <DialogPortal isMounted={isMounted}>
      <DialogOverlay isVisible={isVisible} onClose={onCancel} isLoading={isLoading}>
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-message-dialog-title"
          data-testid="delete-message-dialog"
          className={clsx(
            "w-full max-w-[520px] rounded-[28px] border border-white/10 bg-[#13171f] px-6 py-6 text-white shadow-[0_28px_85px_rgba(0,0,0,0.34)] transition-all duration-[260ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none sm:px-7 sm:py-7",
            isVisible ? "translate-y-0 scale-100 opacity-100" : "translate-y-3 scale-[0.98] opacity-0",
          )}
          onClick={(event) => event.stopPropagation()}
        >
          <h3
            id="delete-message-dialog-title"
            className="text-[1.2rem] font-semibold tracking-tight text-white"
          >
            {title}
          </h3>

          {description ? (
            <p className="mt-4 max-w-[34ch] text-base leading-8 text-white/78">{description}</p>
          ) : null}

          <div className="mt-7 flex flex-wrap items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className="rounded-full border border-white/18 px-5 py-2.5 text-sm font-medium text-white/78 transition hover:border-white/28 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={onDeleteForSelf}
              disabled={isLoading}
              data-testid="delete-message-self"
              className="rounded-full border border-white/12 px-5 py-2.5 text-sm font-semibold text-white transition hover:border-white/22 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Удалить у себя
            </button>
            {allowDeleteForEveryone ? (
              <button
                type="button"
                onClick={onDeleteForEveryone}
                disabled={isLoading}
                data-testid="delete-message-everyone"
                className="min-w-[150px] rounded-full bg-[#63a4ff] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#5199fb] disabled:cursor-not-allowed disabled:opacity-60"
              >
                Удалить у всех
              </button>
            ) : null}
          </div>
        </div>
      </DialogOverlay>
    </DialogPortal>
  );
}

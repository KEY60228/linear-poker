import { useEffect } from "react";
import { ReferenceList } from "./ReferenceList";

/**
 * Right-side drawer that surfaces the reference scale (estimate-grouped
 * project list) without leaving the session view. Anchored to a single team
 * since the session itself already pins a team.
 */
export function ReferenceDrawer({
  open,
  teamId,
  teamLabel,
  onClose,
}: {
  open: boolean;
  teamId: string;
  teamLabel?: string;
  onClose: () => void;
}) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock the page from scrolling underneath while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Reference scale"
      onClick={onClose}
    >
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-header">
          <div>
            <h2>Reference scale</h2>
            {teamLabel && <p className="muted">{teamLabel}</p>}
          </div>
          <button
            className="drawer-close"
            onClick={onClose}
            aria-label="Close reference scale"
          >
            ×
          </button>
        </header>
        <div className="drawer-body">
          <ReferenceList teamId={teamId} />
        </div>
      </aside>
    </div>
  );
}

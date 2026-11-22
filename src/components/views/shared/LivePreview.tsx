import { useEffect, useRef, useState } from "react";
import type React from "react";
import { previewViewHide, previewViewShow } from "../../../lib/commands";
import { isCovered, previewPlace } from "../../../lib/livePreview";

/** Events that mean something may be moving over the box, and that it's stopped. */
const MOTION_STARTS = ["transitionrun", "animationstart"] as const;
const MOTION_ENDS = ["transitionend", "transitioncancel", "animationend", "animationcancel"] as const;
/** How long after a transition or animation starts to keep checking each frame (longer than any in the app). */
const MOVING_WINDOW_MS = 1000;

/**
 * Finder's live preview: the OS's Quick Look view of `path` (a PDF scrolls, a
 * video plays) over this box, which holds the still preview (`children`) for
 * whenever the live one can't show: while something covers the box, or the
 * view couldn't be shown. The live view is see-through where it doesn't draw
 * (around an audio file's icon and player, say), so the still preview is
 * hidden while it's up, or both would show, one over the other.
 */
export default function LivePreview({
  path,
  className,
  children,
}: {
  path: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The view is kept while the box is shown; another file only swaps what it previews
  const pathRef = useRef(path);
  const scheduleRef = useRef<() => void>(() => {});
  const [live, setLive] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let sent = "";
    // Until when to look again every frame: a panel sliding in (a CSS transition)
    // moves over the box without any mutation, scroll or resize to say so
    let movingUntil = 0;

    function send() {
      frame = 0;
      if (performance.now() < movingUntil) schedule();
      if (!el) return;
      const box = el.getBoundingClientRect();
      const place = previewPlace({ x: box.left, y: box.top, width: box.width, height: box.height });
      const covered =
        !place ||
        isCovered(
          place,
          (x, y) => document.elementFromPoint(x, y),
          (hit) => el.contains(hit)
        );
      const path = pathRef.current;
      const next = covered || !place ? "hidden" : `${path}\n${place.x},${place.y},${place.width},${place.height}`;
      if (next === sent) return;
      sent = next;
      if (covered || !place) {
        setLive(false);
        void previewViewHide().catch(() => {});
      } else {
        const shown = next;
        void previewViewShow(path, place)
          // Only if nothing newer was sent meanwhile
          .then(() => sent === shown && setLive(true))
          .catch(() => sent === shown && setLive(false));
      }
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(send);
    };

    scheduleRef.current = schedule;
    schedule();
    const resize = new ResizeObserver(schedule);
    resize.observe(el);
    // Columns scrolling sideways move the box; sheets and popovers arriving cover it
    const mutations = new MutationObserver(schedule);
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const moving = () => {
      movingUntil = performance.now() + MOVING_WINDOW_MS;
      schedule();
    };
    for (const type of MOTION_STARTS) document.addEventListener(type, moving, true);
    for (const type of MOTION_ENDS) document.addEventListener(type, schedule, true);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      for (const type of MOTION_STARTS) document.removeEventListener(type, moving, true);
      for (const type of MOTION_ENDS) document.removeEventListener(type, schedule, true);
      void previewViewHide().catch(() => {});
    };
  }, []);

  useEffect(() => {
    pathRef.current = path;
    scheduleRef.current();
  }, [path]);

  return (
    <div ref={ref} className={className}>
      {/* The box itself stays visible, as the covered check hit-tests it */}
      <div className="contents" style={live ? { visibility: "hidden" } : undefined}>
        {children}
      </div>
    </div>
  );
}

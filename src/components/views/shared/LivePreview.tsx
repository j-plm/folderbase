import { useEffect, useRef } from "react";
import type React from "react";
import { previewViewHide, previewViewShow } from "../../../lib/commands";
import { isCovered, previewPlace } from "../../../lib/livePreview";

/**
 * Finder's live preview: the OS's Quick Look view of `path` (a PDF scrolls, a
 * video plays) over this box, which holds the still preview (`children`) for
 * whenever the live one can't show: while something covers the box, and
 * before it has loaded.
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

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    let sent = "";

    function send() {
      frame = 0;
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
      if (covered || !place) void previewViewHide().catch(() => {});
      else void previewViewShow(path, place).catch(() => {});
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

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      void previewViewHide().catch(() => {});
    };
  }, []);

  useEffect(() => {
    pathRef.current = path;
    scheduleRef.current();
  }, [path]);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}

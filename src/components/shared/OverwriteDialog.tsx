import { useCallback, useRef, useState } from "react";
import Dialog, { DialogButton } from "./Dialog";

interface Request {
  property: string;
  count: number;
}

/**
 * Asks before a Select property's existing values are replaced (by mapping
 * folders, or dropping a tag on its column). `confirm` resolves true for
 * Overwrite and false for Cancel; render `dialog` somewhere in the tree.
 */
export function useOverwriteConfirm() {
  const [request, setRequest] = useState<Request | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const confirm = useCallback(
    (property: string, count: number) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setRequest({ property, count });
      }),
    []
  );

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setRequest(null);
  }, []);
  const cancel = useCallback(() => finish(false), [finish]);

  const dialog = request && (
    <Dialog
      title={`Overwrite existing data in “${request.property}”?`}
      message={`${request.count.toLocaleString()} ${request.count === 1 ? "file already has" : "files already have"} a different ${request.property}. A Select holds one value, so ${request.count === 1 ? "it" : "theirs"} will be replaced.`}
      onCancel={cancel}
      onSubmit={() => finish(true)}
      footer={
        <>
          <span className="flex-1" />
          <DialogButton onClick={cancel}>Cancel</DialogButton>
          <DialogButton variant="default" autoFocus>
            Overwrite
          </DialogButton>
        </>
      }
    />
  );

  return { confirm, dialog };
}

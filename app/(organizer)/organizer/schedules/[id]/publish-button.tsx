"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Publish, disabled until every warning above it is ticked, saying why in
 * words. (The ticks used to be required fields, so an unticked one showed
 * only the browser's own brief bubble: under pressure, Publish looked broken.)
 * Without JavaScript the button stays enabled and the server's refusal names
 * the unticked warnings, as before.
 */
export function PublishButton({
  version,
  className,
  blocked = false,
}: {
  version: number;
  className: string;
  /** Structural errors: it can't be published whatever is ticked. */
  blocked?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [ticks, setTicks] = useState<{ done: number; of: number } | null>(null);
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const boxes = () => [
      ...form.querySelectorAll<HTMLInputElement>('input[name^="ack:"]'),
    ];
    const count = () =>
      setTicks({
        done: boxes().filter((b) => b.checked).length,
        of: boxes().length,
      });
    count();
    form.addEventListener("change", count);
    return () => form.removeEventListener("change", count);
  }, []);
  const waiting = ticks !== null && ticks.done < ticks.of;
  return (
    <div>
      <button ref={ref} className={className} disabled={blocked || waiting}>
        Publish v{version}
      </button>
      {!blocked && waiting && (
        <p role="status" className="mt-2 text-sm font-semibold text-amber-800">
          Tick each warning above to publish: {ticks.done} of {ticks.of} ticked.
        </p>
      )}
    </div>
  );
}

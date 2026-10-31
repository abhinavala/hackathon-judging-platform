"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded border px-3 py-1 text-sm font-medium hover:bg-black/5 print:hidden"
    >
      Print
    </button>
  );
}

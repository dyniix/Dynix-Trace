export function Monogram({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" className={className} aria-hidden>
      <path
        d="M21 15 V49 M21 15 H31 C40 15 46 22.4 46 32 C46 41.6 40 49 31 49 H21"
        stroke="url(#dynix-mono)"
        strokeWidth="4.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function MonogramDefs() {
  return (
    <svg className="absolute size-0" aria-hidden>
      <defs>
        <linearGradient id="dynix-mono" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#67e8f9" />
          <stop offset="55%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
      </defs>
    </svg>
  );
}

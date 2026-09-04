/**
 * Hero artwork: three nested SLA dials at different states.
 *
 * Deliberately a vector motif rather than a photograph. A photo behind live
 * numbers needs a scrim to stay readable, which muddies the palette, and it
 * says nothing about the product — whereas this is literally the gauge from
 * the ticket detail page, enlarged. It also costs nothing to ship, themes
 * itself, and stays crisp at any size.
 *
 * Purely decorative, so it is hidden from assistive technology.
 */
export function HeroDial({ className }: { className?: string }) {
  // Three-quarter dials, matching the SlaRing geometry so the motif and the
  // real gauges are recognisably the same object.
  const rings = [
    { r: 108, width: 14, fraction: 0.82, className: "text-sla-ok" },
    { r: 82, width: 12, fraction: 0.46, className: "text-sla-warn" },
    { r: 58, width: 10, fraction: 1, className: "text-sla-critical" },
  ];

  return (
    <svg viewBox="0 0 280 280" className={className} aria-hidden focusable="false">
      <defs>
        <radialGradient id="hero-dial-glow" cx="50%" cy="45%" r="55%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="140" cy="140" r="130" fill="url(#hero-dial-glow)" className="text-primary" />

      <g transform="rotate(-225 140 140)">
        {rings.map((ring) => {
          const circumference = 2 * Math.PI * ring.r;
          const arc = circumference * 0.75;
          return (
            <g key={ring.r} className={ring.className}>
              <circle
                cx="140"
                cy="140"
                r={ring.r}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.14"
                strokeWidth={ring.width}
                strokeLinecap="round"
                strokeDasharray={`${arc} ${circumference}`}
              />
              <circle
                cx="140"
                cy="140"
                r={ring.r}
                fill="none"
                stroke="currentColor"
                strokeOpacity="0.55"
                strokeWidth={ring.width}
                strokeLinecap="round"
                strokeDasharray={`${arc * ring.fraction} ${circumference}`}
              />
            </g>
          );
        })}
      </g>

      {/* Clock hand, echoing the wordmark. */}
      <g className="text-primary" opacity="0.5">
        <circle cx="140" cy="140" r="5" fill="currentColor" />
        <path
          d="M140 140 L140 96"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path
          d="M140 140 L172 158"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

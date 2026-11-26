import type { HeroClassId } from '../game/classes';

export function ClassEmblem({ id, color, accent }: { id: HeroClassId; color: string; accent: string }) {
  if (id === 'warrior') {
    return (
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true" fill="none">
        {/* Greatsword */}
        <path d="M32 4 L36 10 L36 38 L28 38 L28 10 Z" fill={color} fillOpacity="0.25" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <path d="M32 10 V36" stroke={color} strokeWidth="1.5" />
        <path d="M20 38 H44" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <path d="M32 38 V50" stroke={color} strokeWidth="3" strokeLinecap="round" />
        <circle cx="32" cy="53" r="2.5" fill={color} />
        {/* Lantern */}
        <path d="M46 40 V44" stroke={accent} strokeWidth="1.5" />
        <path d="M43 44 H49 L50 52 H42 Z" fill={accent} fillOpacity="0.35" stroke={accent} strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx="46" cy="48" r="1.6" fill="#ffe7a8" />
        <path d="M42 52 H50 V54 H42 Z" fill={accent} />
      </svg>
    );
  }
  if (id === 'hunter') {
    return (
      <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true" fill="none">
        {/* Recurve bow */}
        <path
          d="M22 8 C40 16, 40 48, 22 56"
          stroke={color}
          strokeWidth="3"
          strokeLinecap="round"
        />
        <path
          d="M22 8 L18 12 M22 56 L18 52"
          stroke={accent}
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        {/* Bowstring */}
        <path d="M21 10 L14 32 L21 54" stroke="#e8dfd2" strokeWidth="1.4" strokeOpacity="0.8" />
        {/* Nocked arrow */}
        <path d="M14 32 H52" stroke={accent} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M45 26 L54 32 L45 38 L48 32 Z" fill={color} stroke={color} strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M12 28 L18 32 L12 36" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" className="w-16 h-16" aria-hidden="true" fill="none">
      <g stroke={color} strokeWidth="2.5" strokeLinecap="round">
        <path d="M32 6 V58" />
        <path d="M9.5 19 L54.5 45" />
        <path d="M9.5 45 L54.5 19" />
      </g>
      <g stroke={color} strokeWidth="2" strokeLinecap="round">
        <path d="M26 10 L32 16 L38 10" />
        <path d="M26 54 L32 48 L38 54" />
        <path d="M12 28 L21 27 L19 18" />
        <path d="M52 36 L43 37 L45 46" />
        <path d="M12 36 L21 37 L19 46" />
        <path d="M52 28 L43 27 L45 18" />
      </g>
      <circle cx="32" cy="32" r="4" fill={accent} stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

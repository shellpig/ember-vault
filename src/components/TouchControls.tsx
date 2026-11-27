import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Wind } from 'lucide-react';
import { isTouchPrimaryDevice } from '../game/engine/input';

/** Stick travel radius in CSS pixels. */
const STICK_RADIUS = 52;

interface TouchControlsProps {
  /** -1..1, x right / y up; (0, 0) releases the stick. */
  onMove: (x: number, y: number) => void;
  onDash: () => void;
  onSkill: () => void;
  skillName: string;
  mobilityName: string;
  skillReady: boolean;
}

/** True on phones / tablets (no hover, coarse pointer); follows changes such as a tablet keyboard dock. */
export function useTouchPrimary(): boolean {
  const [touch, setTouch] = useState(() => isTouchPrimaryDevice());
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(hover: none) and (pointer: coarse)');
    } catch {
      return;
    }
    const onChange = () => setTouch(mq!.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq?.removeEventListener?.('change', onChange);
  }, []);
  return touch;
}

/**
 * Touch-only controls: a movement stick bottom-left (sits above the dock) and skill / mobility buttons bottom-right.
 * Rendered only on touch-primary devices; desktop keeps keyboard + mouse.
 */
export function TouchControls({ onMove, onDash, onSkill, skillName, mobilityName, skillReady }: TouchControlsProps) {
  const baseRef = useRef<HTMLDivElement | null>(null);
  const pointerRef = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const el = baseRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      let dx = clientX - (r.left + r.width / 2);
      let dy = clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d > STICK_RADIUS) {
        dx = (dx / d) * STICK_RADIUS;
        dy = (dy / d) * STICK_RADIUS;
      }
      setKnob({ x: dx, y: dy });
      onMove(dx / STICK_RADIUS, -dy / STICK_RADIUS);
    },
    [onMove]
  );

  const release = useCallback(() => {
    pointerRef.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  }, [onMove]);

  // Never leave the hero walking if the controls unmount mid-drag
  useEffect(() => () => onMove(0, 0), [onMove]);

  return (
    <>
      <div
        ref={baseRef}
        className="absolute left-6 bottom-28 z-40 w-32 h-32 rounded-full border-2 border-[#8f7440]/70 bg-[#0c0e14]/45 pointer-events-auto select-none"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => {
          if (pointerRef.current !== null) return;
          pointerRef.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          update(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (pointerRef.current === e.pointerId) update(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          if (pointerRef.current === e.pointerId) release();
        }}
        onPointerCancel={(e) => {
          if (pointerRef.current === e.pointerId) release();
        }}
        aria-label="移動搖桿"
      >
        <div
          className="absolute left-1/2 top-1/2 w-14 h-14 -ml-7 -mt-7 rounded-full border-2 border-[#e6be63]/85 bg-[#241c0f]/80 shadow-[0_0_14px_rgba(230,190,99,0.35)]"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>

      <div className="absolute right-6 bottom-28 z-40 flex flex-col items-end gap-3 pointer-events-auto select-none" style={{ touchAction: 'none' }}>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            onSkill();
          }}
          className={`w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center font-hud text-[10px] leading-tight ${
            skillReady
              ? 'border-[#e6be63] bg-[#241c0f]/85 text-[#fff0bf] shadow-[0_0_14px_rgba(230,190,99,0.35)]'
              : 'border-[#3d382e] bg-[#13151d]/80 text-[#8d92a2]'
          }`}
          aria-label={skillName}
        >
          <Sparkles className="w-5 h-5 mb-0.5" />
          <span className="max-w-[56px] truncate">{skillName}</span>
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault();
            onDash();
          }}
          className="w-20 h-20 rounded-full border-2 border-[#5ebcf5] bg-[#101821]/85 text-[#cfeeff] flex flex-col items-center justify-center font-hud text-[11px] leading-tight shadow-[0_0_14px_rgba(94,188,245,0.3)]"
          aria-label={mobilityName}
        >
          <Wind className="w-6 h-6 mb-0.5" />
          <span className="max-w-[68px] truncate">{mobilityName}</span>
        </button>
      </div>
    </>
  );
}

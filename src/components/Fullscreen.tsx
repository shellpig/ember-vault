import { useCallback, useEffect, useState } from 'react';
import { Maximize, Minimize, Share, X } from 'lucide-react';

const HINT_STORAGE_KEY = 'embervault.homeScreenHint.v1';
const FS_HINT_STORAGE_KEY = 'embervault.fullscreenHint.v1';

type FsDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type FsElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

function fullscreenSupported(): boolean {
  const d = document as FsDocument;
  return Boolean(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}

function isFullscreen(): boolean {
  const d = document as FsDocument;
  return Boolean(d.fullscreenElement || d.webkitFullscreenElement);
}

/** iPhone / iPod Safari: no Fullscreen API for pages; "Add to Home Screen" is the way to drop the address bar. */
function isIPhone(): boolean {
  return /iPhone|iPod/.test(navigator.userAgent);
}

/** iPad Safari (iPadOS 13+ reports a Mac user agent, so also check for a multi-touch screen). */
function isIPad(): boolean {
  return /iPad/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  try {
    return nav.standalone === true || window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;
  } catch {
    return nav.standalone === true;
  }
}

/** Fullscreen toggle state; `supported` is false where the browser has no Fullscreen API (iPhone Safari). */
export function useFullscreen(): { supported: boolean; active: boolean; toggle: () => void } {
  const [supported] = useState(fullscreenSupported);
  const [active, setActive] = useState(isFullscreen);

  useEffect(() => {
    const onChange = () => setActive(isFullscreen());
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const toggle = useCallback(() => {
    const d = document as FsDocument;
    try {
      if (isFullscreen()) {
        if (d.exitFullscreen) void d.exitFullscreen().catch(() => undefined);
        else void d.webkitExitFullscreen?.();
      } else {
        const el = document.documentElement as FsElement;
        if (el.requestFullscreen) void el.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
        else void el.webkitRequestFullscreen?.();
      }
    } catch {
      // Some browsers throw synchronously when not allowed; nothing to do
    }
  }, []);

  return { supported, active, toggle };
}

/** Seconds the first-time fullscreen tip stays up if the player ignores it. */
const FS_HINT_SECONDS = 12;

/**
 * Dock button: enter / leave fullscreen. Renders nothing where the API is missing. On touch devices it carries a
 * label, and the first time it is shown a tip bubble above it explains it (until used, dismissed or timed out).
 */
export function FullscreenButton({ touch = false, inGame = false }: { touch?: boolean; inGame?: boolean }) {
  const { supported, active, toggle } = useFullscreen();
  // The dock is mounted behind the login / lobby screens too: only show (and time) the tip once in the game
  const [hintDone, setHintDone] = useState(() => {
    try {
      return localStorage.getItem(FS_HINT_STORAGE_KEY) === '1';
    } catch {
      return true;
    }
  });
  const hint = touch && inGame && supported && !hintDone && !active && !isStandalone();

  const closeHint = useCallback(() => {
    setHintDone(true);
    try {
      localStorage.setItem(FS_HINT_STORAGE_KEY, '1');
    } catch {
      // Private mode: the tip just shows again next time
    }
  }, []);

  useEffect(() => {
    if (!hint) return;
    const id = window.setTimeout(closeHint, FS_HINT_SECONDS * 1000);
    return () => window.clearTimeout(id);
  }, [hint, closeHint]);

  if (!supported) return null;
  return (
    <span className="relative shrink-0">
      {hint && (
        <span
          role="status"
          onClick={closeHint}
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2.5 w-[200px] px-3 py-2 bg-[#241c0f] border border-[#e6be63] text-[11px] leading-snug text-[#fff0bf] text-center shadow-[0_0_14px_rgba(230,190,99,0.35)] animate-pulse cursor-pointer z-50"
        >
          點這裡切換<span className="font-bold">全螢幕</span>，畫面會更大；再點一次可還原。
          {/* Arrow pointing down at the button */}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-[7px] border-x-transparent border-t-[7px] border-t-[#e6be63]" />
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          if (hint) closeHint();
          toggle();
        }}
        title={active ? '離開全螢幕' : '全螢幕'}
        aria-pressed={active}
        className={`flex items-center gap-1 p-1.5 border text-xs font-hud transition-colors cursor-pointer whitespace-nowrap ${
          hint
            ? 'border-[#e6be63] bg-[#241c0f] text-[#fff0bf]'
            : 'border-[#3a3428] bg-[#151822] text-[#c7b68d] hover:border-[#b89448] hover:text-[#f3dca0]'
        }`}
      >
        {active ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
        {touch && <span>{active ? '還原' : '全螢幕'}</span>}
      </button>
    </span>
  );
}

/**
 * One-time tip on iPhone / iPad Safari: how to add the game to the Home Screen and play without the address bar
 * (on iPad the page fullscreen exits on a downward swipe, which is easy to trigger mid-fight; the Home Screen app has no such gesture).
 */
export function HomeScreenHint() {
  const [iPad] = useState(isIPad);
  const [show, setShow] = useState(() => {
    try {
      return (isIPhone() || isIPad()) && !isStandalone() && localStorage.getItem(HINT_STORAGE_KEY) !== '1';
    } catch {
      return false;
    }
  });
  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(HINT_STORAGE_KEY, '1');
    } catch {
      // Private mode: the tip just shows again next time
    }
    setShow(false);
  };
  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[80] w-[min(92vw,420px)] flex items-start gap-2 px-3 py-2.5 bg-[#0c0e14]/95 border border-[#8f7440]/80 shadow-[0_10px_28px_rgba(0,0,0,0.75)] text-xs text-[#ece6d8] leading-relaxed">
      <Share className="w-4 h-4 mt-0.5 shrink-0 text-[#e6be63]" />
      <div className="flex-1">
        想用全螢幕玩？點 Safari 的<span className="text-[#f3dca0]">「分享」</span>按鈕，選
        <span className="text-[#f3dca0]">「加入主畫面」</span>，之後從主畫面的圖示開啟就不會有網址列
        {iPad ? '，遊玩時往下拉也不會退出全螢幕。' : '。'}
        <div className="mt-1 text-[11px] text-[#a3a8b8]">第一次從主畫面開啟時需要重新登入一次。</div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="知道了"
        className="p-1 -m-1 text-[#a3a8b8] hover:text-[#ece6d8] cursor-pointer shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

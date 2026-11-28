import { useCallback, useEffect, useState } from 'react';
import { Maximize, Minimize, Share, X } from 'lucide-react';

const HINT_STORAGE_KEY = 'embervault.homeScreenHint.v1';

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

/** Dock button: enter / leave fullscreen. Renders nothing where the API is missing. */
export function FullscreenButton() {
  const { supported, active, toggle } = useFullscreen();
  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={toggle}
      title={active ? '離開全螢幕' : '全螢幕'}
      aria-pressed={active}
      className="p-1.5 border border-[#3a3428] bg-[#151822] text-[#c7b68d] hover:border-[#b89448] hover:text-[#f3dca0] transition-colors cursor-pointer shrink-0"
    >
      {active ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
    </button>
  );
}

/** One-time tip on iPhone Safari: how to add the game to the Home Screen and play without the address bar. */
export function HomeScreenHint() {
  const [show, setShow] = useState(() => {
    try {
      return isIPhone() && !isStandalone() && localStorage.getItem(HINT_STORAGE_KEY) !== '1';
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
        <span className="text-[#f3dca0]">「加入主畫面」</span>，之後從主畫面的圖示開啟就不會有網址列。
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

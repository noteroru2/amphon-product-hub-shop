import { Download, Share2, Smartphone, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import "../styles/pwaInstall.css";

type InstallChoice = {
  outcome: "accepted" | "dismissed";
  platform: string;
};

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<InstallChoice>;
}

type StandaloneNavigator = Navigator & {
  standalone?: boolean;
};

const DISMISS_KEY = "amphon-hub-pwa-install-dismissed-until";
const DISMISS_DAYS = 7;

function isStandaloneMode() {
  const navigatorWithStandalone = navigator as StandaloneNavigator;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    navigatorWithStandalone.standalone === true
  );
}

function isMobileDevice() {
  return (
    window.matchMedia("(max-width: 900px)").matches ||
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

function isIosDevice() {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isSafariOnIos() {
  return (
    isIosDevice() &&
    /Safari/i.test(navigator.userAgent) &&
    !/CriOS|FxiOS|EdgiOS|OPiOS/i.test(navigator.userAgent)
  );
}

export function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [installed, setInstalled] = useState(false);

  const ios = useMemo(() => isIosDevice(), []);
  const safariIos = useMemo(() => isSafariOnIos(), []);

  useEffect(() => {
    if (!isMobileDevice() || isStandaloneMode()) {
      setInstalled(true);
      return;
    }

    const dismissedUntil = Number(localStorage.getItem(DISMISS_KEY) || "0");
    const canShow = !dismissedUntil || dismissedUntil < Date.now();
    let timer: number | undefined;

    const show = () => {
      if (!canShow) return;
      timer = window.setTimeout(() => setVisible(true), 900);
    };

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
      show();
    };

    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setInstallEvent(null);
      localStorage.removeItem(DISMISS_KEY);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);

    if (ios) show();

    return () => {
      if (timer) window.clearTimeout(timer);
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [ios]);

  if (installed || !visible) return null;

  function dismiss() {
    const until = Date.now() + DISMISS_DAYS * 24 * 60 * 60 * 1000;
    localStorage.setItem(DISMISS_KEY, String(until));
    setVisible(false);
  }

  async function install() {
    if (installEvent) {
      await installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice.outcome === "accepted") {
        setVisible(false);
      }
      setInstallEvent(null);
      return;
    }

    setShowInstructions(true);
  }

  return (
    <aside className="pwa-install" role="dialog" aria-label="ติดตั้ง AMPHON Hub">
      <button
        type="button"
        className="pwa-install-close"
        onClick={dismiss}
        aria-label="ปิดคำแนะนำติดตั้ง"
      >
        <X size={18} />
      </button>

      <div className="pwa-install-heading">
        <div className="pwa-install-icon" aria-hidden="true">
          <Smartphone size={22} />
        </div>
        <div>
          <strong>ติดตั้ง AMPHON Hub บนมือถือ</strong>
          <small>เปิดจากหน้าจอหลักได้เหมือนแอป ไม่ต้องเข้าเว็บทุกครั้ง</small>
        </div>
      </div>

      {!showInstructions && (
        <button type="button" className="pwa-install-primary" onClick={() => void install()}>
          <Download size={18} />
          {installEvent ? "ติดตั้งแอป" : ios ? "วิธีเพิ่มไปยังหน้าจอโฮม" : "วิธีติดตั้งแอป"}
        </button>
      )}

      {showInstructions && (
        <div className="pwa-install-instructions">
          {ios ? (
            safariIos ? (
              <>
                <div className="pwa-install-step">
                  <span>1</span>
                  <p>
                    แตะปุ่ม <Share2 size={16} aria-hidden="true" /> <b>แชร์</b> ใน Safari
                  </p>
                </div>
                <div className="pwa-install-step">
                  <span>2</span>
                  <p>เลือก <b>เพิ่มไปยังหน้าจอโฮม</b></p>
                </div>
                <div className="pwa-install-step">
                  <span>3</span>
                  <p>แตะ <b>เพิ่ม</b> แล้วเปิด AMPHON Hub จากไอคอนบนหน้าจอ</p>
                </div>
              </>
            ) : (
              <p className="pwa-install-note">
                บน iPhone/iPad ให้เปิดหน้านี้ด้วย <b>Safari</b> ก่อน จากนั้นแตะ แชร์ → เพิ่มไปยังหน้าจอโฮม
              </p>
            )
          ) : (
            <p className="pwa-install-note">
              เปิดเมนูของเบราว์เซอร์ แล้วเลือก <b>ติดตั้งแอป</b> หรือ <b>เพิ่มไปยังหน้าจอหลัก</b>
            </p>
          )}
          <button
            type="button"
            className="pwa-install-secondary"
            onClick={() => setShowInstructions(false)}
          >
            กลับ
          </button>
        </div>
      )}
    </aside>
  );
}

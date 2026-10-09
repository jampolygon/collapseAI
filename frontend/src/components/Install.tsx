import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useInstall, type InstallState } from '../lib/install';

function ManualSteps({ ios }: { ios: boolean }) {
  return ios ? (
    <ol className="install-steps small">
      <li>Open this page in <b>Safari</b>.</li>
      <li>Tap <b>Share</b> (square with an arrow).</li>
      <li>Tap <b>Add to Home Screen</b>.</li>
    </ol>
  ) : (
    <ol className="install-steps small">
      <li>Tap the browser menu <b>⋮</b> (top or bottom right).</li>
      <li>Tap <b>Install app</b> or <b>Add to Home screen</b>.</li>
    </ol>
  );
}

const WHY = 'Opens like a normal app from your home screen, full screen, and works with no internet.';

/** First visit: ask to install. "Not now" (or refusing the browser dialog) moves it to the Prepare card. */
export function InstallPrompt() {
  const s = useInstall();
  const [manual, setManual] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const show = s.available && !s.dismissed;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (show && !d.open) d.showModal?.();
    if (!show && d.open) d.close();
  }, [show]);

  if (!show) return null;
  const install = async () => {
    if ((await s.install()) === 'manual') setManual(true);
  };
  return (
    <dialog ref={ref} className="install-dialog" aria-labelledby="install-title" onCancel={(e) => { e.preventDefault(); s.dismiss(); }}>
      <div className="install-head"><img src="./icon-192.png" alt="" width={48} height={48} /><h2 id="install-title">Install CollapseAI</h2></div>
      <p>{WHY}</p>
      {manual || (!s.canPrompt && s.ios) ? <ManualSteps ios={s.ios} /> : null}
      <div className="install-actions">
        <button onClick={s.dismiss}>Not now</button>
        {!manual && <button className="primary" onClick={install}><Icon name="download" size={16} />{s.canPrompt ? 'Install app' : 'Show me how'}</button>}
        {manual && <button className="primary" onClick={s.dismiss}>Got it</button>}
      </div>
    </dialog>
  );
}

/** Prepare screen: the install offer stays here after the user said "Not now". */
export function InstallCard({ state }: { state?: InstallState }) {
  const own = useInstall();
  const s = state ?? own;
  const [manual, setManual] = useState(false);
  if (!s.available || !s.dismissed) return null;
  const install = async () => {
    if ((await s.install()) === 'manual') setManual(true);
  };
  return (
    <section className="install-card" aria-label="Install the app">
      <img src="./icon-192.png" alt="" width={40} height={40} />
      <div className="install-card-body">
        <h3>Install CollapseAI on this device</h3>
        <p className="muted small">{WHY}</p>
        {(manual || !s.canPrompt) && <ManualSteps ios={s.ios} />}
      </div>
      {s.canPrompt && !manual && <button className="primary" onClick={install}><Icon name="download" size={16} />Install</button>}
    </section>
  );
}

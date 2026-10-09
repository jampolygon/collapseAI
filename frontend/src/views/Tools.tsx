import { useEffect, useRef, useState } from 'react';
import { useLocalState } from '../hooks';
import { Icon, plainLabel } from '../components/Icon';

export default function Tools() {
  return (
    <div className="page-content tools-page">
      <header className="page-intro"><span className="eyebrow">Tools / Field utilities</span><h2>Tools for the field.</h2><p>Simple utilities that work on this device.<br />No AI model required.</p></header>
      <div className="tools-grid">
      <SOS />
      <WaterCalc />
      <GoBag />
      </div>
      <div className="planned-tools"><Icon name="compass" size={18} /><span>Compass &amp; offline map</span><span className="muted tiny">Planned · not yet available</span></div>
    </div>
  );
}

/* ---------------- SOS signal: screen + flashlight ---------------- */

const UNIT = 250; // ms per Morse unit
// S O S = ... --- ...  (on, off) pairs in units
const SOS_PATTERN: [number, number][] = [
  [1, 1], [1, 1], [1, 3],
  [3, 1], [3, 1], [3, 3],
  [1, 1], [1, 1], [1, 7],
];

function SOS() {
  const [running, setRunning] = useState(false);
  const [lit, setLit] = useState(false);
  const [torchOk, setTorchOk] = useState<boolean | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);

  useEffect(() => {
    if (!running) return;
    let stop = false;
    (async () => {
      // Try the real flashlight (Chrome on Android); fall back to flashing the screen.
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        const track = stream.getVideoTracks()[0];
        const caps: any = track.getCapabilities?.() ?? {};
        if (caps.torch) {
          trackRef.current = track;
          setTorchOk(true);
        } else {
          track.stop();
          setTorchOk(false);
        }
      } catch {
        setTorchOk(false);
      }
      const set = async (on: boolean) => {
        setLit(on);
        try {
          await trackRef.current?.applyConstraints({ advanced: [{ torch: on } as any] });
        } catch {
          /* ignore */
        }
      };
      while (!stop) {
        for (const [on, off] of SOS_PATTERN) {
          if (stop) break;
          await set(true);
          await sleep(on * UNIT);
          await set(false);
          await sleep(off * UNIT);
        }
      }
    })();
    return () => {
      stop = true;
      setLit(false);
      trackRef.current?.stop();
      trackRef.current = null;
    };
  }, [running]);

  return (
    <section className="tool-section sos-tool">
      <div className="tool-heading"><Icon name="flashlight" size={22} /><span className="eyebrow">01 / Signaling</span></div><h3>SOS signal</h3>
      <p className="muted small">Flashes S-O-S in Morse code with the flashlight or screen.</p>
      <div className="morse-preview mono" aria-label="SOS: three short, three long, three short">··· <span>———</span> ···</div>
      <button className={running ? 'danger big' : 'primary big'} onClick={() => setRunning(!running)}>
        {running ? 'Stop SOS' : 'Start SOS'}
      </button>
      {running && torchOk === false && <p className="muted tiny">No flashlight access. Using the screen instead; turn brightness up.</p>}
      {running && <button autoFocus className={`sos-overlay ${lit ? 'lit' : ''}`} aria-label="Stop SOS signal" onClick={() => setRunning(false)} onKeyDown={event => { if (event.key === 'Escape') setRunning(false); if (event.key === 'Tab') event.preventDefault(); }}>Tap to stop · Esc</button>}
    </section>
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* ---------------- Water purification calculator ---------------- */

function WaterCalc() {
  const [liters, setLiters] = useState(4);
  const [strength, setStrength] = useState<'6' | '8.25'>('6');
  const [cloudy, setCloudy] = useState(false);
  // US CDC: 6% bleach = 8 drops/gallon, 8.25% = 6 drops/gallon; double if cloudy or very cold.
  const perGallon = strength === '6' ? 8 : 6;
  const drops = Math.ceil((liters / 3.785) * perGallon * (cloudy ? 2 : 1));
  return (
    <section className="tool-section water-tool">
      <div className="tool-heading"><Icon name="water" size={22} /><span className="eyebrow">02 / Water treatment</span></div><h3>Water purification</h3><p className="muted small">Enter your water volume and bleach strength.</p>
      <div className="form-row">
        <label>
          Water (liters)
          <input type="number" min={0.5} step={0.5} value={liters} onChange={(e) => setLiters(Number(e.target.value) || 0)} />
        </label>
        <label>
          Bleach strength
          <select value={strength} onChange={(e) => setStrength(e.target.value as '6' | '8.25')}>
            <option value="6">5–6% (most brands)</option>
            <option value="8.25">8.25%</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={cloudy} onChange={(e) => setCloudy(e.target.checked)} /> Cloudy / very cold water
        </label>
      </div>
      <p className="result">
        Add <b>{drops} drops</b> of plain, unscented bleach. Stir, wait <b>30 minutes</b>.
      </p>
      <p className="muted small">
        It should smell slightly of chlorine. If not, repeat and wait 15 more minutes. Filter cloudy water through cloth first.
        Best option if you have fuel: <b>boil for 1 minute</b> (rolling boil).
      </p>
    </section>
  );
}

/* ---------------- Go-bag checklist ---------------- */

const GOBAG = [
  'Water: 4 liters per person per day (3 days)',
  'Ready-to-eat food (3 days)',
  'Flashlight + extra batteries',
  'Power bank (charged) + cable',
  'First aid kit + personal medicines',
  'Copies of IDs and documents (in plastic)',
  'Cash in small bills',
  'Whistle',
  'Raincoat / jacket, extra clothes',
  'Face masks, alcohol, soap',
  'Battery / crank radio',
  'Phone with CollapseAI downloaded 😉',
];

function GoBag() {
  const [checked, setChecked] = useLocalState<string[]>('cai.gobag', []);
  const toggle = (item: string) => setChecked(checked.includes(item) ? checked.filter((c) => c !== item) : [...checked, item]);
  return (
    <section className="tool-section gobag-tool">
      <div className="tool-heading"><Icon name="bag" size={22} /><span className="eyebrow">03 / Preparedness</span></div><div className="section-heading"><h3>72-hour go-bag</h3>
        <span className="muted small mono">
          {checked.length}/{GOBAG.length}
        </span>
      </div><p className="muted small">Keep the essentials together. Your checklist is saved on this device.</p>
      {GOBAG.map((g) => (
        <label key={g} className="check-item">
          <input type="checkbox" checked={checked.includes(g)} onChange={() => toggle(g)} /><span>{plainLabel(g)}</span>
        </label>
      ))}
    </section>
  );
}

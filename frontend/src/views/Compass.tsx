import { useEffect, useState } from 'react';
import * as SunCalcNS from 'suncalc';
import { Icon } from '../components/Icon';
import { PLACE_KINDS, bearing, cardinal, distance, fmtDistance, loadPlaces, savePlaces, setTargetId, useGps, usePlaces, type Place } from '../lib/geo';

// suncalc is CommonJS: depending on the bundler the API is on the namespace or on .default
const SunCalc: typeof SunCalcNS = (SunCalcNS as any).default ?? SunCalcNS;

/** Phone compass (magnetometer) + direction to a saved place + sun direction as a backup. All offline. */
export default function Compass() {
  const [heading, setHeading] = useState<number | null>(null);
  const [needsPermission, setNeedsPermission] = useState(false);
  const [noSensor, setNoSensor] = useState(false);
  const { fix, error } = useGps();
  const [places, targetId] = usePlaces();
  const target = places.find((p) => p.id === targetId) ?? null;
  const [kind, setKind] = useState<Place['kind']>('home');
  const [name, setName] = useState('');

  useEffect(() => {
    let got = false;
    const screenAngle = () => (screen.orientation?.angle ?? 0) as number;
    const onAbs = (e: DeviceOrientationEvent) => {
      if (e.alpha == null) return;
      got = true;
      setHeading((360 - e.alpha + screenAngle()) % 360);
    };
    const onRel = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      if (e.webkitCompassHeading != null) {
        got = true;
        setHeading((e.webkitCompassHeading + screenAngle()) % 360); // iPhone
      }
    };
    window.addEventListener('deviceorientationabsolute', onAbs as EventListener);
    window.addEventListener('deviceorientation', onRel as EventListener);
    // iPhone needs an explicit permission tap; Android Chrome does not
    if (typeof (DeviceOrientationEvent as any)?.requestPermission === 'function' && /iPhone|iPad/i.test(navigator.userAgent)) setNeedsPermission(true);
    const t = setTimeout(() => !got && setNoSensor(true), 2500);
    return () => {
      clearTimeout(t);
      window.removeEventListener('deviceorientationabsolute', onAbs as EventListener);
      window.removeEventListener('deviceorientation', onRel as EventListener);
    };
  }, []);

  const askPermission = async () => {
    try {
      await (DeviceOrientationEvent as any).requestPermission();
      setNeedsPermission(false);
    } catch {
      /* denied */
    }
  };

  const saveHere = () => {
    if (!fix) return;
    const p: Place = { id: `p-${Date.now()}`, name: name.trim() || PLACE_KINDS[kind].label, kind, lat: fix.lat, lon: fix.lon };
    savePlaces([...loadPlaces(), p]);
    setName('');
  };

  const h = heading ?? 0;
  const targetBearing = fix && target ? bearing(fix, target) : null;
  const sun = fix ? sunInfo(fix.lat, fix.lon) : null;

  return (
    <div className="page-content compass-page">
      <header className="page-intro">
        <span className="eyebrow">Compass / Direction</span>
        <h2>Find your way.</h2>
        <p>Uses the phone's compass and GPS. Both work with no signal.</p>
      </header>
      <div className="tools-grid">
        <section className="tool-section compass-tool">
          <div className="tool-heading"><Icon name="needle" size={22} /><span className="eyebrow">01 / Heading</span></div>
          <svg viewBox="0 0 200 200" className="compass" role="img" aria-label={heading !== null ? `Heading ${Math.round(h)} degrees ${cardinal(h)}` : 'Compass'}>
            <g className="compass-rose" style={{ transform: `rotate(${-h}deg)` }}>
              <circle cx="100" cy="100" r="92" className="dial" />
              {Array.from({ length: 72 }, (_, i) => (
                <line key={i} x1="100" y1="10" x2="100" y2={i % 6 === 0 ? 22 : 16} className="tick" transform={`rotate(${i * 5} 100 100)`} />
              ))}
              {['N', 'E', 'S', 'W'].map((d, i) => (
                <text key={d} x="100" y="40" className={d === 'N' ? 'cardinal north' : 'cardinal'} transform={`rotate(${i * 90} 100 100)`}>
                  {d}
                </text>
              ))}
              {targetBearing !== null && <polygon points="100,46 108,64 92,64" className="target-arrow" transform={`rotate(${targetBearing} 100 100)`} />}
              {sun?.up && <circle cx="100" cy="62" r="5" className="sun-dot" transform={`rotate(${sun.bearing} 100 100)`} />}
            </g>
            <polygon points="100,4 106,18 94,18" className="lubber" />
          </svg>
          <div className="heading-readout">
            {heading !== null ? (
              <><b className="mono">{Math.round(h)}°</b> <span>{cardinal(h)}</span></>
            ) : (
              <span className="muted small">{noSensor ? 'No compass sensor found. Use the sun direction below.' : 'Reading sensor…'}</span>
            )}
          </div>
          {needsPermission && <button className="primary" onClick={askPermission}>Enable compass</button>}
          <p className="muted tiny">Hold the phone flat. Wave it in a figure-8 if the direction looks wrong. Keep away from metal and magnets.</p>
        </section>

        <section className="tool-section">
          <div className="tool-heading"><Icon name="pin" size={22} /><span className="eyebrow">02 / Go to a place</span></div>
          <h3>Saved places</h3>
          {places.length === 0 ? (
            <p className="muted small">No places yet. Stand at home, your evacuation center or a water source and save it below.</p>
          ) : (
            <label className="field-label">
              Go to
              <select value={targetId ?? ''} onChange={(e) => setTargetId(e.target.value || null)}>
                <option value="">Choose a place…</option>
                {places.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
          )}
          {target && fix && targetBearing !== null && (
            <p className="result">
              <b>{fmtDistance(distance(fix, target))}</b> away, toward <b>{cardinal(targetBearing)}</b> ({Math.round(targetBearing)}°)
              {heading !== null && <><br />{turnHint(targetBearing - h)}</>}
            </p>
          )}
          {target && !fix && <p className="muted small">{error ?? 'Waiting for GPS…'}</p>}

          <div className="save-place">
            <span className="muted small">Save where you are now</span>
            <div className="form-row">
              <select value={kind} onChange={(e) => setKind(e.target.value as Place['kind'])} aria-label="Place type">
                {Object.entries(PLACE_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Place name" />
              <button onClick={saveHere} disabled={!fix}>Save spot</button>
            </div>
            {!fix && <p className="muted tiny">{error ?? 'Waiting for GPS… go outside for a better signal.'}</p>}
          </div>
          {places.length > 0 && (
            <ul className="place-list">
              {places.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span className="muted small mono">{fix ? `${fmtDistance(distance(fix, p))} ${cardinal(bearing(fix, p))}` : ''}</span>
                  <button className="link" onClick={() => confirm(`Delete ${p.name}?`) && savePlaces(places.filter((x) => x.id !== p.id))}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="tool-section">
          <div className="tool-heading"><Icon name="sun" size={22} /><span className="eyebrow">03 / Sun direction</span></div>
          <h3>Direction from the sun</h3>
          {sun ? (
            <p className="small">
              {sun.up ? (
                <>The sun is at <b>{Math.round(sun.bearing)}°</b> ({cardinal(sun.bearing)}). Face the sun: north is <b>{Math.round((360 - sun.bearing) % 360)}°</b> to your right.</>
              ) : (
                <>The sun is down. At night, find Polaris (the North Star) low in the northern sky.</>
              )}
              <br />
              <span className="muted">Sunrise {sun.sunrise} · Sunset {sun.sunset} · {sun.daylightLeft}</span>
            </p>
          ) : (
            <p className="muted small">Needs your location (GPS works without internet).</p>
          )}
        </section>
      </div>
    </div>
  );
}

function turnHint(diff: number) {
  const d = ((((diff % 360) + 540) % 360) - 180); // -180..180
  if (Math.abs(d) < 10) return 'Straight ahead';
  return d > 0 ? `Turn right ${Math.round(d)}°` : `Turn left ${Math.round(-d)}°`;
}

function sunInfo(lat: number, lon: number) {
  const now = new Date();
  const pos = SunCalc.getPosition(now, lat, lon);
  const times = SunCalc.getTimes(now, lat, lon);
  const fmt = (d: Date | null) => (d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '–');
  const left = times.sunset ? times.sunset.getTime() - now.getTime() : 0;
  return {
    up: pos.altitude > 0,
    // suncalc v2: azimuth is already a compass bearing in degrees (clockwise from north)
    bearing: (pos.azimuth + 360) % 360,
    sunrise: fmt(times.sunrise),
    sunset: fmt(times.sunset),
    daylightLeft: left > 0 ? `${Math.floor(left / 3.6e6)} h ${Math.round((left % 3.6e6) / 6e4)} min of daylight left` : 'after sunset',
  };
}

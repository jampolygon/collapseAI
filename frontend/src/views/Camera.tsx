import { useState } from 'react';
import { VISION_MODEL, modelKey, visionKey } from '../lib/catalog';
import { enqueue, getFile, type DLItem } from '../lib/downloads';
import { describeImage, loadedModel, loadModel } from '../lib/llm';
import { fmtMB } from '../lib/device';
import { Icon } from '../components/Icon';

const PROMPTS = [
  'What is in this photo? Describe it simply.',
  'What plant is this? Describe its leaves and features.',
  'Describe this wound or injury. How serious does it look?',
  'Read the text in this photo.',
];

interface Props {
  downloads: DLItem[];
  onModelChange: () => void;
}

/** Take a photo and ask the on-device vision AI about it. The photo never leaves the phone. */
export default function Camera({ downloads, onModelChange }: Props) {
  const [img, setImg] = useState<{ url: string; data: ArrayBuffer } | null>(null);
  const [prompt, setPrompt] = useState(PROMPTS[0]);
  const [custom, setCustom] = useState(false);
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const status = (k: string) => downloads.find((d) => d.key === k);
  const files = [status(modelKey(VISION_MODEL.id)), status(visionKey(VISION_MODEL.id))];
  const ready = files.every((d) => d?.status === 'done');
  const pending = files.filter((d): d is DLItem => !!d && d.status !== 'done');

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setAnswer('');
    setErr(null);
    try {
      setImg(await shrink(f, 512));
    } catch {
      setErr('Could not read that image. Try another photo.');
    }
  };

  const download = () => {
    enqueue({ key: modelKey(VISION_MODEL.id), label: `Photo AI: ${VISION_MODEL.name}`, url: VISION_MODEL.url, sizeMB: VISION_MODEL.sizeMB });
    enqueue({ key: visionKey(VISION_MODEL.id), label: 'Photo AI: vision add-on', url: VISION_MODEL.vision.url, sizeMB: VISION_MODEL.vision.sizeMB });
  };

  const run = async () => {
    if (!img || busy) return;
    setErr(null);
    setAnswer('');
    try {
      if (loadedModel()?.id !== VISION_MODEL.id) {
        setBusy('Starting the photo AI…');
        const [m, p] = await Promise.all([getFile(modelKey(VISION_MODEL.id)), getFile(visionKey(VISION_MODEL.id))]);
        if (!m || !p) throw new Error('Photo AI files are missing. Download them again.');
        await loadModel(VISION_MODEL, m, [p]);
        onModelChange();
      }
      setBusy('Looking at the photo…');
      let acc = '';
      await describeImage(img.data, prompt, (t) => {
        acc += t;
        setAnswer(acc);
      });
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="page-content camera-page">
      <header className="page-intro">
        <span className="eyebrow">Photo / Vision AI</span>
        <h2>Ask about a photo.</h2>
        <p>Plants, injuries, labels, signs. The AI runs on this device, so the photo never leaves your phone.</p>
      </header>

      <section className="tool-section camera-tool">
        <div className="tool-heading"><Icon name="camera" size={22} /><span className="eyebrow">Photo AI · {VISION_MODEL.family}</span></div>
        {!ready && (
          <div className="banner warn">
            <Icon name="info" size={18} />
            <span>Needs the Photo AI ({fmtMB(VISION_MODEL.sizeMB + VISION_MODEL.vision.sizeMB)}), separate from the chat AI.</span>
            {pending.length ? (
              <span className="mono small">Downloading… {pending.map((d) => `${Math.round((d.done / (d.total || 1)) * 100)}%`).join(' / ')}</span>
            ) : (
              <button className="link" onClick={download}>Download it</button>
            )}
          </div>
        )}

        <label className="camera-btn">
          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="sr-only" />
          <span className="as-button primary big"><Icon name="camera" size={18} /> Take or choose a photo</span>
        </label>

        {img && <img src={img.url} alt="Your photo" className="photo" />}

        {img && (
          <div className="camera-ask">
            <label className="field-label">
              Question
              <select value={custom ? '' : prompt} onChange={(e) => { const v = e.target.value; setCustom(!v); if (v) setPrompt(v); }}>
                {PROMPTS.map((p) => <option key={p} value={p}>{p}</option>)}
                <option value="">Custom question…</option>
              </select>
            </label>
            {custom && <input placeholder="Ask about the photo…" value={prompt} onChange={(e) => setPrompt(e.target.value)} aria-label="Custom question" />}
            <button className="primary" disabled={!ready || !!busy || !prompt.trim()} onClick={run}>{busy ?? 'Ask about this photo'}</button>
          </div>
        )}

        {answer && <div className="result" aria-live="polite">{answer}</div>}
        {err && <p className="error small" role="alert">{err}</p>}
        <p className="muted tiny">Photo AI is small and can be wrong. Never eat a plant or take a medicine based only on this. Loading it unloads the chat AI.</p>
      </section>
    </div>
  );
}

/** Downscale to save time: small vision models only look at ~512 px anyway. */
async function shrink(file: File, max: number): Promise<{ url: string; data: ArrayBuffer }> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const blob: Blob = await new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('encode failed'))), 'image/jpeg', 0.85));
  return { url: URL.createObjectURL(blob), data: await blob.arrayBuffer() };
}

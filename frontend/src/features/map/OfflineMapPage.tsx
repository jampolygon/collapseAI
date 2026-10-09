import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../../components/Icon';
import type { Theme } from '../../ui/theme';
import { deleteDownloadedRegion, listDownloadedRegions } from './offlineMapRepository';
import { downloadMapRegion, type DownloadProgress } from './regionDownload';
import { EXPECTED_MAP_REGIONS, loadMapCatalog, regionContains } from './regionCatalog';
import type { DownloadedMapRegion, MapCatalog, MapCenter, MapRegion } from './mapTypes';
import { fmtBytes } from '../../lib/device';
import OfflineMapCanvas from './OfflineMapCanvas';
import { EMERGENCY_POIS } from './emergencyPois';

interface Props {
  online: boolean;
  theme: Theme;
}

type LocationState =
  | { kind: 'idle'; message: string }
  | { kind: 'working'; message: string }
  | { kind: 'ready'; message: string }
  | { kind: 'error'; message: string };

const INITIAL_LOCATION: LocationState = { kind: 'idle', message: 'Location stays on this device.' };

function locate(): Promise<MapCenter> {
  if (!navigator.geolocation) return Promise.reject(new Error('Location is not available in this browser. Select a region manually.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      position => resolve([position.coords.longitude, position.coords.latitude]),
      error => {
        if (error.code === error.PERMISSION_DENIED) reject(new Error('Location permission was denied. You can still choose a downloaded region manually.'));
        else if (error.code === error.TIMEOUT) reject(new Error('Location lookup timed out. Try again or choose a region manually.'));
        else reject(new Error('The device could not determine your location. Choose a region manually.'));
      },
      { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
    );
  });
}

export default function OfflineMapPage({ online, theme }: Props) {
  const [catalog, setCatalog] = useState<MapCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState<DownloadedMapRegion[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [location, setLocation] = useState<MapCenter | null>(null);
  const [locationState, setLocationState] = useState<LocationState>(INITIAL_LOCATION);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [storageWarning, setStorageWarning] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);

  const selectedDownloaded = downloaded.find(region => region.id === selectedId);
  const selectedPublished = catalog?.regions.find(region => region.id === selectedId);
  const updateAvailable = Boolean(
    selectedDownloaded && selectedPublished &&
    (selectedDownloaded.revision !== selectedPublished.revision || selectedDownloaded.sha256 !== selectedPublished.sha256),
  );
  const regionsById = useMemo(() => new Map(downloaded.map(region => [region.id, region])), [downloaded]);
  const publishedById = useMemo(() => new Map((catalog?.regions ?? []).map(region => [region.id, region])), [catalog]);

  const refreshDownloaded = useCallback(async () => {
    const records = await listDownloadedRegions(setDownloadError);
    setDownloaded(records);
    setSelectedId(current => current || records[0]?.id || '');
  }, []);

  const refreshCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const next = await loadMapCatalog();
      setCatalog(next);
      setSelectedId(current => current || next.regions[0]?.id || '');
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : 'Could not load the offline-map catalog.');
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void listDownloadedRegions(message => { if (active) setDownloadError(message); }).then(records => {
      if (active) {
        setDownloaded(records);
        setSelectedId(current => current || records[0]?.id || '');
      }
    }).catch(error => {
      if (active) setDownloadError(error instanceof Error ? error.message : 'Could not read locally stored maps.');
    });
    void loadMapCatalog().then(next => {
      if (active) {
        setCatalog(next);
        setSelectedId(current => current || next.regions[0]?.id || '');
      }
    }).catch(error => {
      if (active) setCatalogError(error instanceof Error ? error.message : 'Could not load the offline-map catalog.');
    }).finally(() => {
      if (active) setCatalogLoading(false);
    });
    return () => {
      active = false;
      controllerRef.current?.abort();
    };
  }, []);

  const useMyLocation = async () => {
    setLocationState({ kind: 'working', message: 'Checking device location…' });
    try {
      const point = await locate();
      setLocation(point);
      const downloadedMatch = downloaded.find(region => regionContains(region, point));
      const publishedMatch = catalog?.regions.find(region => regionContains(region, point));
      if (downloadedMatch) {
        setSelectedId(downloadedMatch.id);
        setLocationState({ kind: 'ready', message: `Location found inside downloaded coverage: ${downloadedMatch.name}.` });
      } else if (publishedMatch) {
        setSelectedId(publishedMatch.id);
        setLocationState({ kind: 'ready', message: `Location is within ${publishedMatch.name}. Download it from a reachable map source to use it offline.` });
      } else {
        setLocationState({ kind: 'ready', message: 'Location found, but no downloaded map covers it. Choose a supported region below.' });
      }
    } catch (error) {
      setLocationState({ kind: 'error', message: error instanceof Error ? error.message : 'Could not get device location.' });
    }
  };

  const startDownload = async (region: MapRegion) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setBusy(true);
    setProgress({ receivedBytes: 0, totalBytes: region.sizeBytes });
    setDownloadError(null);
    setStorageWarning(null);
    try {
      const result = await downloadMapRegion(region, controller.signal, setProgress);
      await refreshDownloaded();
      setSelectedId(region.id);
      if (!result.persistentStorage) {
        setStorageWarning('The browser did not grant persistent storage. It may clear this map if device storage is low.');
      }
    } catch (error) {
      if (controller.signal.aborted) {
        setDownloadError('Map download cancelled. Any previously verified map remains stored.');
      } else {
        setDownloadError(error instanceof Error ? error.message : 'Map download failed.');
      }
    } finally {
      controllerRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  const removeMap = async (region: DownloadedMapRegion) => {
    if (!window.confirm(`Delete the downloaded ${region.name} map from this device?`)) return;
    try {
      await deleteDownloadedRegion(region.id);
      const remaining = downloaded.filter(item => item.id !== region.id);
      setDownloaded(remaining);
      setSelectedId(remaining[0]?.id ?? '');
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not delete the local map.');
    }
  };

  const matchingDownloaded = location
    ? downloaded.find(region => regionContains(region, location))
    : undefined;
  const activeRegion = selectedDownloaded;
  const matchingPublished = location ? catalog?.regions.find(region => regionContains(region, location)) : undefined;

  return (
    <div className="page-content map-page">
      <header className="page-intro">
        <span className="eyebrow">Map / Offline maps</span>
        <h2>Maps that stay with you.</h2>
        <p>Download a prepared region before you need it. Map files and your location stay on this device.</p>
      </header>

      <section className="map-controls" aria-label="Map options">
        <button className="primary" onClick={() => void useMyLocation()} disabled={locationState.kind === 'working'}>
          <Icon name="compass" size={18} />{locationState.kind === 'working' ? 'Finding location…' : 'Use my location'}
        </button>
        <label className="map-region-select">
          <span>Choose a region</span>
          <select value={selectedId} onChange={event => { setSelectedId(event.target.value); setLocation(null); setLocationState(INITIAL_LOCATION); }} aria-label="Choose a map region">
            <option value="">Select a region</option>
            {[...new Set([...EXPECTED_MAP_REGIONS.map(region => region.id), ...downloaded.map(region => region.id), ...(catalog?.regions.map(region => region.id) ?? [])])].map(id => {
              const region = regionsById.get(id) ?? publishedById.get(id) ?? EXPECTED_MAP_REGIONS.find(region => region.id === id);
              if (!region) return null;
              const storedRegion = regionsById.get(id);
              const publishedRegion = publishedById.get(id);
              const update = storedRegion && publishedRegion &&
                (storedRegion.revision !== publishedRegion.revision || storedRegion.sha256 !== publishedRegion.sha256);
              return <option key={id} value={id}>{region.name}{update ? ' · Update available' : storedRegion ? ' · Available on this device' : publishedRegion ? ' · Download available' : ' · Not downloaded (source unavailable)'}</option>;
            })}
          </select>
        </label>
      </section>

      <p className={`map-location-state map-state-${locationState.kind}`} role={locationState.kind === 'error' ? 'alert' : 'status'}>
        {locationState.message}
      </p>
      {catalogLoading && <p className="muted small" role="status">Checking for published map regions…</p>}
      {!catalogLoading && catalogError && (
        <div className="map-notice" role="status">
          <Icon name="info" size={18} />
          <span>{catalogError} {online ? '' : 'Previously downloaded maps remain available offline.'}</span>
          <button className="link" onClick={() => void refreshCatalog()}>Retry</button>
        </div>
      )}
      {!catalogLoading && catalog?.regions.length === 0 && (
        <div className="map-notice" role="status">
          <Icon name="info" size={18} />
          <span>No regional map files are available from this source. Existing verified maps remain available on this device.</span>
          <button className="link" onClick={() => void refreshCatalog()}>Refresh</button>
        </div>
      )}

      {activeRegion ? (
        <div className="map-active-region">
          <div className="map-region-heading">
            <div><span className="eyebrow">Local file verified · {activeRegion.revision}</span><h3>{activeRegion.name}</h3><p className="muted tiny">Verified {new Date(activeRegion.verifiedAt).toLocaleDateString()} · {fmtBytes(activeRegion.sizeBytes)}</p></div>
            <div className="map-region-actions">
              {updateAvailable && selectedPublished && <button className="primary" disabled={busy} onClick={() => void startDownload(selectedPublished)}>{busy ? 'Updating…' : 'Download update'}</button>}
              <button className="danger map-delete" onClick={() => void removeMap(activeRegion)} aria-label={`Delete ${activeRegion.name} map`}><Icon name="trash" size={18} />Delete map</button>
            </div>
          </div>
          <OfflineMapCanvas region={activeRegion} theme={theme} location={location} />
          {busy && progress && (
            <div className="map-download-progress">
              <progress aria-label="Map update progress" max={progress.totalBytes} value={progress.receivedBytes} />
              <span className="muted tiny">{fmtBytes(progress.receivedBytes)} of {fmtBytes(progress.totalBytes)}</span>
              <button onClick={() => controllerRef.current?.abort()}>Cancel update</button>
            </div>
          )}
          {EMERGENCY_POIS.length === 0 && (
            <p className="map-data-note">No independently verified emergency locations are included yet. This map does not provide live conditions or evacuation routing.</p>
          )}
        </div>
      ) : selectedPublished ? (
        <section className="map-region-card">
          <div><span className="eyebrow">Prepared region</span><h3>{selectedPublished.name}</h3><p className="muted small">{selectedPublished.province} · Updated {selectedPublished.updatedAt}</p></div>
          <p className="map-size">{fmtBytes(selectedPublished.sizeBytes)}</p>
          {busy && progress && (
            <div className="map-download-progress">
              <progress aria-label="Map download progress" max={progress.totalBytes} value={progress.receivedBytes} />
              <span className="muted tiny">{fmtBytes(progress.receivedBytes)} of {fmtBytes(progress.totalBytes)}</span>
            </div>
          )}
          <button className="primary" disabled={busy} onClick={() => void startDownload(selectedPublished)}>
            {busy ? 'Downloading…' : 'Download for offline use'}
          </button>
          {busy && <button onClick={() => controllerRef.current?.abort()}>Cancel</button>}
          <p className="muted tiny">OpenStreetMap data · © OpenStreetMap contributors</p>
        </section>
      ) : EXPECTED_MAP_REGIONS.some(region => region.id === selectedId) ? (
        <div className="map-empty"><h3>{EXPECTED_MAP_REGIONS.find(region => region.id === selectedId)?.name} · Not downloaded</h3><p>The map source has no available {selectedId}.pmtiles file. Install a real extract and refresh the catalog.</p></div>
      ) : catalog?.regions.length === 0 && downloaded.length === 0 ? (
        <div className="map-empty">
          <Icon name="compass" size={28} />
          <h3>No offline map available yet</h3>
          <p>Luzon, Visayas and Mindanao are not downloaded. Install real regional PMTiles files at the map source before downloading them here.</p>
          {!online && <p className="muted small">You are offline. No map archive is stored on this device yet.</p>}
        </div>
      ) : location && !matchingDownloaded ? (
        <div className="map-empty"><h3>No downloaded map covers your location</h3><p>{matchingPublished ? `${matchingPublished.name} covers your location. Download it while connected to use the map offline.` : 'There is no published map coverage for this location yet.'}</p></div>
      ) : !catalogLoading && !catalogError && !downloaded.length && !selectedPublished ? (
        <div className="map-empty"><h3>Select a prepared region</h3><p>Choose a published region above or use your device location to find matching coverage.</p></div>
      ) : null}

      {downloaded.length > 0 && (
        <section className="map-downloaded-list">
          <div className="section-heading"><h3>Stored on this device</h3><span className="muted tiny mono">{downloaded.length} region{downloaded.length === 1 ? '' : 's'}</span></div>
          {downloaded.map(region => (
            <div className="map-downloaded-row" key={region.id}>
              <button className="link" onClick={() => { setSelectedId(region.id); setLocation(null); setLocationState(INITIAL_LOCATION); }}>{region.name}</button>
              <span className="muted tiny">{fmtBytes(region.sizeBytes)} · verified {new Date(region.verifiedAt).toLocaleDateString()}</span>
              {publishedById.has(region.id) && (
                publishedById.get(region.id)?.revision !== region.revision || publishedById.get(region.id)?.sha256 !== region.sha256
              ) && (
                <button className="link" onClick={() => setSelectedId(region.id)}>Update available</button>
              )}
            </div>
          ))}
        </section>
      )}

      {(downloadError || storageWarning) && (
        <div className={downloadError ? 'map-notice map-notice-error' : 'map-notice'} role={downloadError ? 'alert' : 'status'}>
          <Icon name="info" size={18} /><span>{downloadError ?? storageWarning}</span>
          {downloadError && <button className="link" onClick={() => setDownloadError(null)}>Dismiss</button>}
        </div>
      )}

      {matchingPublished && !matchingDownloaded && location && (
        <p className="muted tiny">Your current location is inside {matchingPublished.name}; download it while connected for offline coverage.</p>
      )}
    </div>
  );
}

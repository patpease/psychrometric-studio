/**
 * Saving, sharing, and exporting.
 *
 * One panel, because these are all the same question — *how do I get this out
 * of the browser* — and splitting them across the interface would make the user
 * hunt. Ordered by how often each is reached: the project file first, since it
 * is the one that loses work if it is hard to find.
 *
 * Every export carries the application version, the calculation basis, the site
 * pressure, and the unit system. That is not boilerplate: a chart or a table
 * that cannot be traced to the release that produced it is a liability, and
 * these files outlive the session that made them.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SolvedAirstream } from '../processes/chain.js';
import type { Atmosphere } from '../psych/atmosphere.js';
import type { ChartDomain, ChartMargin } from '../chart/scales.js';
import type { UnitSystem } from '../psych/units.js';
import type { ProjectMeta } from '../types/project.js';
import type { WeatherMode } from '../chart/WeatherLayer.js';
import type { WeatherHour } from '../weather/epw.js';
import {
  projectFilename,
  readProject,
  toProject,
  writeProject,
  type SessionState,
} from '../io/project.js';
import { shareLink } from '../io/url.js';
import { toCsv } from '../io/csv.js';
import { chartToBase64Png, chartToPng, chartToSvg } from '../io/image.js';
import { downloadBlob, downloadText } from '../io/download.js';
import { API_BASE, buildReportPayload, reportServiceAvailable, requestReport } from '../io/report.js';
import { DISCLAIMER } from '../config/branding.js';

export interface ExportPanelProps {
  session: SessionState;
  solved: SolvedAirstream;
  units: UnitSystem;
  atmosphere: Atmosphere;
  domain: ChartDomain;
  margin?: ChartMargin | undefined;
  chartRef: React.RefObject<SVGSVGElement | null>;
  weather: { hours: readonly WeatherHour[]; mode: WeatherMode };
  onMetaChange: (meta: ProjectMeta) => void;
  /** Called with a validated project when the user opens a file. */
  onOpen: (text: string) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; message: string }
  | { kind: 'done'; message: string }
  | { kind: 'failed'; message: string };

/**
 * The user-editable half of the metadata.
 *
 * Typed as the string-valued keys only. `createdWith` and the timestamps are
 * also `ProjectMeta`, and they are stamped by the tool rather than typed by
 * anyone — putting them in a text box would let a report claim to have been
 * produced by a version that never existed.
 */
type EditableMetaKey = 'name' | 'projectNumber' | 'client' | 'engineer' | 'notes';

const META_FIELDS: { key: EditableMetaKey; label: string; long?: boolean }[] = [
  { key: 'name', label: 'Project name' },
  { key: 'projectNumber', label: 'Project number' },
  { key: 'client', label: 'Client' },
  { key: 'engineer', label: 'Engineer' },
  { key: 'notes', label: 'Notes', long: true },
];

export function ExportPanel({
  session,
  solved,
  units,
  atmosphere,
  domain,
  margin,
  chartRef,
  weather,
  onMetaChange,
  onOpen,
}: ExportPanelProps): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [link, setLink] = useState<ReturnType<typeof shareLink> | null>(null);
  const [pdfAvailable, setPdfAvailable] = useState<boolean | null>(null);

  /**
   * Ask once whether the report service is up.
   *
   * The button is not shown until it answers. Offering an export that then
   * fails is worse than not offering it: the user has already decided the tool
   * can do the thing.
   */
  useEffect(() => {
    let live = true;
    void reportServiceAvailable().then((ok) => {
      if (live) setPdfAvailable(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  /** Run an export, reporting whatever goes wrong rather than swallowing it. */
  const run = useCallback(
    async (message: string, action: () => void | Promise<void>): Promise<void> => {
      setStatus({ kind: 'busy', message });
      try {
        await action();
        setStatus({ kind: 'done', message: `${message} — done.` });
      } catch (error) {
        setStatus({
          kind: 'failed',
          message: error instanceof Error ? error.message : `${message} failed.`,
        });
      }
    },
    [],
  );

  const chartOptions = useCallback(() => {
    const svg = chartRef.current;
    if (!svg) throw new Error('The chart is not on screen yet.');
    return {
      svg,
      domain,
      margin,
      weather,
      caption: session.meta.name ?? undefined,
    };
  }, [chartRef, domain, margin, weather, session.meta.name]);

  const project = () => toProject(session);

  return (
    <section className="export-panel">
      <h3>Project</h3>
      {META_FIELDS.map((field) => (
        <div className="field" key={field.key}>
          <label htmlFor={`meta-${field.key}`}>{field.label}</label>
          {field.long ? (
            <textarea
              id={`meta-${field.key}`}
              rows={2}
              value={session.meta[field.key] ?? ''}
              onChange={(event) => onMetaChange({ ...session.meta, [field.key]: event.target.value })}
            />
          ) : (
            <input
              id={`meta-${field.key}`}
              type="text"
              value={session.meta[field.key] ?? ''}
              onChange={(event) => onMetaChange({ ...session.meta, [field.key]: event.target.value })}
            />
          )}
        </div>
      ))}

      <div className="export-actions">
        <button
          type="button"
          onClick={() =>
            void run('Saving the project', () => {
              downloadText(
                writeProject(project()),
                projectFilename(session.meta, 'json'),
                'application/json',
              );
            })
          }
        >
          Save project
        </button>
        <button type="button" onClick={() => fileRef.current?.click()}>
          Open project
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so that opening the same file twice in a row still fires
            // a change event — otherwise a failed load cannot be retried.
            event.target.value = '';
            if (!file) return;
            void run('Opening the project', async () => {
              const text = await file.text();
              const result = readProject(text);
              if (!result.project) throw new Error(result.problems.join(' '));
              onOpen(text);
            });
          }}
        />
      </div>

      <h3>Share</h3>
      <p className="comfort-note">
        The whole project travels in the link, after the <code>#</code> — which
        browsers never send to a server. Nothing is uploaded and nothing is
        stored.
      </p>
      <div className="export-actions">
        <button
          type="button"
          onClick={() => {
            const made = shareLink(project(), window.location.href);
            setLink(made);
            if (made.usable) {
              void navigator.clipboard
                ?.writeText(made.url)
                .then(() => setStatus({ kind: 'done', message: 'Link copied to the clipboard.' }))
                .catch(() =>
                  setStatus({ kind: 'done', message: 'Link ready — select and copy it below.' }),
                );
            }
          }}
        >
          Create a share link
        </button>
      </div>
      {link && !link.usable && <p className="comfort-limit">{link.reason}</p>}
      {link?.usable && (
        <textarea className="share-link" readOnly rows={3} value={link.url} onFocus={(e) => e.target.select()} />
      )}

      <h3>Export</h3>
      <div className="export-actions">
        <button
          type="button"
          onClick={() =>
            void run('Writing the CSV', () => {
              downloadText(
                toCsv({ solved, units, atmosphere, meta: session.meta }),
                projectFilename(session.meta, 'csv'),
                'text/csv',
              );
            })
          }
        >
          CSV
        </button>
        <button
          type="button"
          onClick={() =>
            void run('Rendering the PNG', async () => {
              const blob = await chartToPng(chartOptions(), 2);
              downloadBlob(blob, projectFilename(session.meta, 'png'));
            })
          }
        >
          PNG
        </button>
        <button
          type="button"
          onClick={() =>
            void run('Writing the SVG', () => {
              downloadText(
                chartToSvg(chartOptions()),
                projectFilename(session.meta, 'svg'),
                'image/svg+xml',
              );
            })
          }
        >
          SVG
        </button>
      </div>
      <p className="comfort-note">
        Charts export on a light background whatever theme you are using, and
        carry the version, calculation basis, and site pressure along the bottom.
      </p>

      {pdfAvailable && (
        <>
          <h3>Report</h3>
          <div className="export-actions">
            <button
              type="button"
              className="primary"
              onClick={() =>
                void run('Rendering the report', async () => {
                  // The chart is rasterised rather than sent as vector: a PDF
                  // that embeds an SVG needs a converter on the server, and the
                  // one thing this service must not do is acquire a second
                  // rendering path that can disagree with the first.
                  const chartPng = await chartToBase64Png(chartOptions(), 2).catch(() => undefined);
                  const blob = await requestReport(
                    buildReportPayload({ solved, units, atmosphere, meta: session.meta, chartPng }),
                  );
                  downloadBlob(blob, projectFilename(session.meta, 'pdf'));
                })
              }
            >
              Branded PDF report
            </button>
          </div>
        </>
      )}
      {pdfAvailable === false && (
        <p className="comfort-note">
          {/* Two different situations, and telling them apart is the whole
              value of the message: one is a deployment that ships without the
              service, the other is a service that is down. Only the second is
              worth anyone investigating. */}
          {API_BASE
            ? 'PDF reports need the rendering service, which is not answering right now.'
            : 'This build ships without the PDF report service.'}{' '}
          Every other export here runs entirely in your browser.
        </p>
      )}

      {status.kind !== 'idle' && (
        <p className={status.kind === 'failed' ? 'comfort-limit' : 'comfort-note'}>{status.message}</p>
      )}

      <p className="disclaimer export-disclaimer">{DISCLAIMER}</p>
    </section>
  );
}

import { Check, Copy, Database, Download, FileSpreadsheet, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DatabaseStatus } from '../../shared/types';
import { api } from '../lib/api';
import { copy, type Lang } from '../lib/i18n';

interface DatabaseViewProps {
  lang: Lang;
  dbStatus: DatabaseStatus | null;
  onRefresh: () => Promise<void>;
  onNotify: (msg: string) => void;
}

export function DatabaseView({ lang, dbStatus, onRefresh, onNotify }: DatabaseViewProps) {
  const t = copy[lang].database;
  const [schemaSql, setSchemaSql] = useState('');
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    api
      .getDbSchema()
      .then((res) => setSchemaSql(res.sql))
      .catch(() =>
        setSchemaSql('-- Schema file available at supabase/migrations/001_initial_schema.sql')
      );
  }, []);

  const handleCopySchema = async () => {
    try {
      await navigator.clipboard.writeText(schemaSql);
      setCopied(true);
      onNotify('Supabase SQL schema copied to clipboard');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      onNotify('Copy failed — select from the SQL box manually');
    }
  };

  const handleExportJson = async () => {
    try {
      setExporting(true);
      const dump = await api.exportAll();
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `momodinks-sideout-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify('Exported full database backup (JSON)');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    try {
      setExporting(true);
      const dump = await api.exportAll();
      const header = [
        'match_id',
        'date',
        'game_type',
        'scoring_mode',
        'status',
        'team_a',
        'team_b',
        'team_a_score',
        'team_b_score',
        'winner_team',
        'rallies_count',
        'duration_seconds',
      ].join(',');

      const escapeCsv = (val: string | number | null | undefined) => {
        const str = String(val ?? '');
        return str.includes(',') || str.includes('"') ? `"${str.replaceAll('"', '""')}"` : str;
      };

      const rows = dump.matches.map((m) =>
        [
          m.id,
          m.completed_at ?? m.started_at,
          m.game_type,
          m.scoring_mode,
          m.status,
          m.team_a_name,
          m.team_b_name,
          m.team_a_score,
          m.team_b_score,
          m.winner_team ?? '',
          m.rallies.length,
          m.duration_seconds,
        ]
          .map(escapeCsv)
          .join(',')
      );

      const csv = [header, ...rows].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `momodinks-matches-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify('Exported match history (CSV)');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'CSV export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="navy-section-banner">
        <div>
          <h1>{t.title}</h1>
          <p className="banner-sub">{t.subtitle}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={handleExportCsv}
            disabled={exporting}
          >
            <FileSpreadsheet size={15} /> {t.exportCsv}
          </button>
          <button
            type="button"
            className="btn btn-lime btn-sm"
            onClick={handleExportJson}
            disabled={exporting}
          >
            <Download size={15} /> {t.backupJson}
          </button>
        </div>
      </div>

      <div className="card card-confirmed" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'var(--brand-emerald-soft)',
                color: 'var(--brand-emerald)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Database size={20} />
            </div>
            <div>
              <div style={{ fontWeight: 800, fontSize: '1.02rem' }}>
                {dbStatus?.label ?? 'Checking connection...'}
              </div>
              <div style={{ fontSize: '0.82rem', color: 'var(--ink-secondary)' }}>
                {dbStatus?.details}
              </div>
            </div>
          </div>

          <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh}>
            <RefreshCw size={14} /> {t.checkHealth}
          </button>
        </div>

        <div className="stat-strip">
          <div className="stat-box">
            <div className="section-heading" style={{ margin: 0 }}>players</div>
            <div className="stat-value">{dbStatus?.counts.players ?? 0}</div>
          </div>
          <div className="stat-box">
            <div className="section-heading" style={{ margin: 0 }}>sessions</div>
            <div className="stat-value">{dbStatus?.counts.sessions ?? 0}</div>
          </div>
          <div className="stat-box">
            <div className="section-heading" style={{ margin: 0 }}>matches</div>
            <div className="stat-value">{dbStatus?.counts.matches ?? 0}</div>
          </div>
          <div className="stat-box">
            <div className="section-heading" style={{ margin: 0 }}>rally_events</div>
            <div className="stat-value">{dbStatus?.counts.rallies ?? 0}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <span className="section-heading" style={{ margin: 0 }}>
          Connect Your Supabase or PostgreSQL Database in 2 Steps
        </span>
        <ol
          style={{
            margin: 0,
            paddingLeft: 20,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            fontSize: '0.9rem',
            color: 'var(--ink-secondary)',
          }}
        >
          <li>
            Run the SQL migration below in your <strong>Supabase SQL Editor</strong> (or via{' '}
            <code>psql "$DATABASE_URL" -f supabase/migrations/001_initial_schema.sql</code>).
          </li>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> and set either{' '}
            <code>SUPABASE_URL</code> + <code>SUPABASE_SERVICE_ROLE_KEY</code> (Supabase adapter)
            or <code>DATABASE_URL</code> (direct PostgreSQL adapter), then restart{' '}
            <code>npm run dev</code>.
          </li>
        </ol>
        <div className="code-block">{`# .env (Option A — Supabase JS Client)
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...

# .env (Option B — Direct PostgreSQL / Supabase Connection Pooler)
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@db.YOUR_PROJECT.supabase.co:5432/postgres`}</div>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="section-heading" style={{ margin: 0 }}>
            supabase/migrations/001_initial_schema.sql
          </span>
          <button type="button" className="btn btn-navy btn-sm" onClick={handleCopySchema}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? 'Copied' : 'Copy SQL'}
          </button>
        </div>
        <div className="code-block">{schemaSql}</div>
      </div>
    </div>
  );
}

import {
  Activity,
  Calendar,
  Check,
  History,
  Languages,
  MapPin,
  Moon,
  Share2,
  Sun,
  Trophy,
  Users,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DatabaseStatus, Match, Player, Session } from '../shared/types';
import { DatabaseView } from './components/DatabaseView';
import { HistoryView } from './components/HistoryView';
import { PlayersView } from './components/PlayersView';
import { ScorekeeperView } from './components/ScorekeeperView';
import { SessionsView } from './components/SessionsView';
import { api } from './lib/api';
import { copy, type Lang } from './lib/i18n';

type NavTab = 'play' | 'sessions' | 'history' | 'players' | 'database';

export default function App() {
  const [tab, setTab] = useState<NavTab>('play');
  const [lang, setLang] = useState<Lang>(() => {
    const saved = localStorage.getItem('momodinks_lang');
    return saved === 'ja' ? 'ja' : 'en';
  });
  const [hasManualTheme, setHasManualTheme] = useState<boolean>(() => {
    const saved = localStorage.getItem('momodinks_theme');
    return saved === 'dark' || saved === 'light';
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const saved = localStorage.getItem('momodinks_theme');
    if (saved === 'dark' || saved === 'light') return saved;
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  const [players, setPlayers] = useState<Player[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [matches, setMatches] = useState<Match[]>([]);
  const [dbStatus, setDbStatus] = useState<DatabaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeMatchId, setActiveMatchId] = useState<string | null>(null);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);

  const t = copy[lang];

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    if (hasManualTheme) {
      localStorage.setItem('momodinks_theme', theme);
    }
  }, [theme, hasManualTheme]);

  useEffect(() => {
    if (hasManualTheme || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [hasManualTheme]);

  useEffect(() => {
    document.documentElement.setAttribute('lang', lang);
    localStorage.setItem('momodinks_lang', lang);
  }, [lang]);

  const refreshAll = useCallback(async () => {
    try {
      setError(null);
      const [pList, sList, mList, status] = await Promise.all([
        api.listPlayers(),
        api.listSessions(),
        api.listMatches(),
        api.getDbStatus(),
      ]);
      setPlayers(pList);
      setSessions(sList);
      setMatches(mList);
      setDbStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Sideout API server');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const activeMatch = useMemo(
    () => matches.find((m) => m.id === activeMatchId) ?? null,
    [matches, activeMatchId]
  );

  const inProgressMatches = useMemo(
    () => matches.filter((m) => m.status === 'in_progress'),
    [matches]
  );

  const activeSessionCount = useMemo(
    () => sessions.filter((s) => s.status === 'active').length,
    [sessions]
  );

  const handleMatchUpdated = useCallback((updated: Match) => {
    setMatches((prev) => {
      const exists = prev.some((m) => m.id === updated.id);
      if (!exists) return [updated, ...prev];
      return prev.map((m) => (m.id === updated.id ? updated : m));
    });
    if (updated.session_id) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== updated.session_id) return s;
          const sMatches = s.matches ?? [];
          const has = sMatches.some((m) => m.id === updated.id);
          return {
            ...s,
            matches: has
              ? sMatches.map((m) => (m.id === updated.id ? updated : m))
              : [updated, ...sMatches],
          };
        })
      );
    }
  }, []);

  const handleOpenScorekeeper = useCallback((match: Match) => {
    setActiveMatchId(match.id);
    setTab('play');
  }, []);

  const handleBackToSession = useCallback((sessionId: string) => {
    setSelectedSessionId(sessionId);
    setTab('sessions');
  }, []);

  const handleShare = async () => {
    try {
      if (navigator.share) {
        await navigator.share({
          title: '桃dinks — Sideout Pickleball',
          url: window.location.href,
        });
      } else {
        await navigator.clipboard.writeText(window.location.href);
        notify(t.copiedLink);
      }
    } catch {
      // user cancelled share sheet
    }
  };

  const navItems: Array<{
    id: NavTab;
    label: string;
    icon: typeof Activity;
    badge?: number;
  }> = [
    { id: 'play', label: t.tabs.play, icon: Activity, badge: inProgressMatches.length || undefined },
    { id: 'sessions', label: t.tabs.sessions, icon: Users, badge: activeSessionCount || undefined },
    { id: 'history', label: t.tabs.history, icon: History, badge: matches.length || undefined },
    { id: 'players', label: t.tabs.players, icon: Trophy },
  ];

  const dbLabel = dbStatus ? t.dbShort[dbStatus.driver] : '...';
  const schedulerBaseUrl =
    (import.meta.env.VITE_SESSION_SCHEDULER_URL as string | undefined)?.trim() ||
    (import.meta.env.DEV ? 'http://localhost:5174' : 'https://pb-session-scheduler.vercel.app');

  const handleOpenScheduler = () => {
    try {
      const target = new URL(schedulerBaseUrl, window.location.origin);
      target.searchParams.set('lang', lang);
      window.location.assign(target.toString());
    } catch {
      window.location.assign(schedulerBaseUrl);
    }
  };

  return (
    <div className="momo-shell">
      {/* Full-Width 桃dinks Deep Navy Header Bar */}
      <header className="momo-header">
        <div className="momo-header-inner">
          <div className="momo-brand">
            <div className="momo-icon-box">
              <img src="/favicon.png" alt="桃dinks" />
            </div>
            <div className="momo-brand-meta">
              <div className="momo-badge-row">
                <div className="momo-app-toggle" role="group" aria-label="Switch web app">
                  <span className="momo-app-toggle-item is-active">
                    {t.badgeTop}
                  </span>
                  <button
                    type="button"
                    className="momo-app-toggle-item tactile-press"
                    onClick={handleOpenScheduler}
                    title={
                      lang === 'ja'
                        ? 'session-scheduler に切り替える'
                        : 'Switch to session-scheduler'
                    }
                  >
                    <Calendar size={11} /> {t.schedulerBadge}
                  </button>
                </div>
                <button
                  type="button"
                  className={`momo-glass-pill tactile-press ${
                    !dbStatus || !dbStatus.connected ? 'is-warn' : ''
                  }`}
                  onClick={() => setTab('database')}
                  title="Database status"
                >
                  <span
                    className={`status-dot ${
                      !dbStatus ? 'warn' : dbStatus.connected ? 'ok' : 'err'
                    }`}
                  />
                  <span>{dbLabel}</span>
                </button>
              </div>
              <div className="momo-wordmark-row">
                <span className="momo-wordmark">
                  <span className="momo-kanji">桃</span>
                  <span className="momo-dinks">dinks</span>
                </span>
                <span className="momo-app-sub">{t.appTitle}</span>
              </div>
              <div className="momo-location-line tabular-nums">
                <MapPin size={14} style={{ color: 'var(--optic-lime-soft)', flexShrink: 0 }} />
                <span>
                  {t.subtitlePrefix} · {players.length}{' '}
                  {lang === 'ja' ? '名登録' : 'Players'} · {matches.length}{' '}
                  {lang === 'ja' ? '試合記録' : 'Matches'}
                </span>
              </div>
            </div>
          </div>

          <div className="momo-header-actions">
            {/* JA | EN Language Capsule */}
            <div className="lang-capsule" role="group" aria-label="Language switcher">
              <button
                type="button"
                id="btn-lang-ja"
                className={`lang-btn ${lang === 'ja' ? 'active' : ''}`}
                onClick={() => setLang('ja')}
              >
                <Languages size={14} /> JA
              </button>
              <button
                type="button"
                id="btn-lang-en"
                className={`lang-btn ${lang === 'en' ? 'active' : ''}`}
                onClick={() => setLang('en')}
              >
                EN
              </button>
            </div>

            <button
              type="button"
              className="header-theme-btn"
              onClick={() => {
                setHasManualTheme(true);
                setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
              }}
              title={theme === 'light' ? t.themeDark : t.themeLight}
              aria-label="Toggle theme"
            >
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </button>

            <button
              type="button"
              className="header-share-btn"
              onClick={handleShare}
            >
              <Share2 size={16} /> {t.share}
            </button>
          </div>
        </div>
      </header>

      {/* Main Centered Container */}
      <main className="page-container">
        {/* Desktop Pill Tab Strip (matches reference pill navigation) */}
        <nav className="desktop-nav-bar" aria-label="Primary Navigation">
          <div className="nav-pills-group">
            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  id={`nav-${item.id}`}
                  className={`nav-pill-btn ${tab === item.id ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  <Icon size={16} />
                  <span>{item.label}</span>
                  {item.badge !== undefined && <span className="nav-pill-count">{item.badge}</span>}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {activeMatch && tab !== 'play' && (
              <button
                type="button"
                className="btn btn-lime btn-sm"
                onClick={() => setTab('play')}
              >
                <Activity size={14} />
                {lang === 'ja' ? '進行中スコアへ' : 'Live Court'}: {activeMatch.team_a_score}-
                {activeMatch.team_b_score}
              </button>
            )}
          </div>
        </nav>

        {error && (
          <div
            className="card"
            style={{
              borderColor: 'var(--danger)',
              background: 'var(--danger-soft)',
              color: 'var(--danger)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <span style={{ fontWeight: 700, fontSize: '0.88rem' }}>{error}</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={refreshAll}>
              Retry
            </button>
          </div>
        )}

        {loading ? (
          <div className="card empty-state">
            <div style={{ fontWeight: 700 }}>
              {lang === 'ja' ? '桃dinks を読み込み中…' : 'Loading 桃dinks Pickleball…'}
            </div>
          </div>
        ) : (
          <>
            {tab === 'play' && (
              <ScorekeeperView
                lang={lang}
                players={players}
                matches={matches}
                activeMatch={activeMatch}
                inProgressMatches={inProgressMatches}
                onSelectMatch={(m) => setActiveMatchId(m?.id ?? null)}
                onMatchUpdated={handleMatchUpdated}
                onBackToSession={handleBackToSession}
                onNotify={notify}
              />
            )}

            {tab === 'sessions' && (
              <SessionsView
                lang={lang}
                sessions={sessions}
                players={players}
                selectedSessionId={selectedSessionId}
                onSelectSession={setSelectedSessionId}
                onOpenScorekeeper={handleOpenScorekeeper}
                onRefreshAll={refreshAll}
                onPlayerCreated={(p) => setPlayers((prev) => [...prev, p])}
                onNotify={notify}
              />
            )}

            {tab === 'history' && (
              <HistoryView
                lang={lang}
                matches={matches}
                players={players}
                sessions={sessions}
                onResumeMatch={handleOpenScorekeeper}
                onRefreshAll={refreshAll}
                onNotify={notify}
              />
            )}

            {tab === 'players' && (
              <PlayersView
                lang={lang}
                players={players}
                matches={matches}
                onRefreshAll={refreshAll}
                onNotify={notify}
              />
            )}

            {tab === 'database' && (
              <DatabaseView
                lang={lang}
                dbStatus={dbStatus}
                onRefresh={refreshAll}
                onNotify={notify}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`mobile-nav-btn ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Toast Feedback */}
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <Check size={16} style={{ color: 'var(--optic-lime-soft)', flexShrink: 0 }} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

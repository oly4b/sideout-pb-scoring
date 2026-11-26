import { Plus, RefreshCw, Swords, Trash2, Trophy, UserCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { computePlayerDetailStats, computeStandings } from '../../shared/statsEngine';
import type { Match, Player } from '../../shared/types';
import { api } from '../lib/api';
import { copy, type Lang } from '../lib/i18n';

interface PlayersViewProps {
  lang: Lang;
  players: Player[];
  matches: Match[];
  onRefreshAll: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const SWATCHES = ['#1D4ED8', '#15803D', '#E25747', '#B45309', '#0E7490', '#BE185D', '#3F6212', '#132B4F'];

export function PlayersView({ lang, players, matches, onRefreshAll, onNotify }: PlayersViewProps) {
  const t = copy[lang].players;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [rating, setRating] = useState('3.50');
  const [color, setColor] = useState(SWATCHES[0]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const handleSyncFromScheduler = async () => {
    try {
      setSyncing(true);
      const data = await api.getSchedulerUpcoming();
      if (!data.connected) {
        onNotify(data.error || 'Scheduler database not connected');
        return;
      }
      const existingNames = new Set<string>();
      for (const p of players) {
        existingNames.add(p.name.trim().toLowerCase());
        if (p.nickname?.trim()) existingNames.add(p.nickname.trim().toLowerCase());
      }

      let added = 0;
      for (const sp of data.players) {
        const key = sp.name.trim().toLowerCase();
        if (!key || existingNames.has(key)) continue;
        await api.createPlayer({
          name: sp.name.trim(),
          skill_rating: 3.5,
          avatar_color: SWATCHES[(players.length + added) % SWATCHES.length],
        });
        existingNames.add(key);
        added++;
      }

      if (added > 0) {
        await onRefreshAll();
        onNotify(
          lang === 'ja'
            ? `Schedulerから${added}名のプレイヤーを同期しました`
            : `Synced ${added} player(s) from session-scheduler`
        );
      } else {
        onNotify(
          lang === 'ja'
            ? 'ロスターはSchedulerと同期済みです'
            : 'Roster is already up to date with session-scheduler'
        );
      }
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to sync players');
    } finally {
      setSyncing(false);
    }
  };

  const standings = useMemo(() => computeStandings(players, matches), [players, matches]);
  const detail = useMemo(
    () => (selectedId ? computePlayerDetailStats(selectedId, players, matches) : null),
    [selectedId, players, matches]
  );

  const handleAddPlayer = async () => {
    if (!name.trim()) {
      onNotify('Enter a player name');
      return;
    }
    try {
      setSaving(true);
      await api.createPlayer({
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        skill_rating: Math.min(8, Math.max(1, Number(rating) || 3.5)),
        avatar_color: color,
      });
      setName('');
      setNickname('');
      setRating('3.50');
      setShowModal(false);
      await onRefreshAll();
      onNotify('Player added to roster');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create player');
    } finally {
      setSaving(false);
    }
  };

  const handleDeletePlayer = async (id: string) => {
    try {
      await api.deletePlayer(id);
      setSelectedId(null);
      await onRefreshAll();
      onNotify('Player removed');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to remove player');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <section className="section-card is-strong-border">
        <div className="section-card-header">
          <div className="section-card-title">
            <Trophy size={16} />
            <div>
              <h1>{t.title}</h1>
              <div className="section-card-sub">{t.subtitle}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => void handleSyncFromScheduler()}
              disabled={syncing}
            >
              <RefreshCw size={14} />{' '}
              {lang === 'ja' ? 'Scheduler同期' : 'Sync Scheduler'}
            </button>
            <button
              type="button"
              id="btn-add-player"
              className="btn btn-lime btn-sm"
              onClick={() => {
                setColor(SWATCHES[players.length % SWATCHES.length]);
                setShowModal(true);
              }}
            >
              <Plus size={15} /> {t.addPlayer}
            </button>
          </div>
        </div>

        <div className="section-subbar">
          <span
            className="section-heading"
            style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Trophy size={14} /> {t.leaderboard} ({players.length})
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)' }}>{t.clickHint}</span>
        </div>

        <div className="section-card-body" style={{ padding: 0 }}>
          <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Player</th>
                <th className="num">Rating</th>
                <th className="num">W-L</th>
                <th className="num">Win %</th>
                <th className="num">+/-</th>
                <th className="num">Streak</th>
              </tr>
            </thead>
            <tbody>
              {standings.map((row, idx) => (
                <tr
                  key={row.player_id}
                  style={{
                    cursor: 'pointer',
                    background:
                      selectedId === row.player_id ? 'var(--brand-emerald-soft)' : undefined,
                  }}
                  onClick={() => setSelectedId(row.player_id)}
                >
                  <td
                    style={{
                      fontWeight: 800,
                      color: idx === 0 ? 'var(--brand-emerald)' : 'var(--ink-muted)',
                    }}
                  >
                    {idx + 1}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span className="avatar avatar-sm" style={{ background: row.avatar_color }}>
                        {row.name
                          .split(' ')
                          .map((n) => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </span>
                      <span style={{ fontWeight: 700 }}>{row.name}</span>
                    </div>
                  </td>
                  <td className="num">{row.skill_rating.toFixed(2)}</td>
                  <td className="num">
                    {row.wins}-{row.losses}
                  </td>
                  <td className="num">{row.games_played > 0 ? `${row.win_pct}%` : '—'}</td>
                  <td
                    className={`num ${
                      row.point_diff > 0 ? 'diff-pos' : row.point_diff < 0 ? 'diff-neg' : ''
                    }`}
                  >
                    {row.point_diff > 0 ? `+${row.point_diff}` : row.point_diff}
                  </td>
                  <td className="num">
                    {row.streak > 0 ? (
                      <span className="tag tag-live">W{row.streak}</span>
                    ) : row.streak < 0 ? (
                      <span className="tag tag-peach">L{Math.abs(row.streak)}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </section>

      {detail && (
        <div className="card card-confirmed" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span className="avatar avatar-lg" style={{ background: detail.avatar_color }}>
                {detail.name
                  .split(' ')
                  .map((n) => n[0])
                  .join('')
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
              <div>
                <h2 style={{ margin: 0, fontSize: '1.18rem', fontWeight: 800 }}>{detail.name}</h2>
                <div style={{ fontSize: '0.84rem', color: 'var(--ink-secondary)', marginTop: 2 }}>
                  Skill {detail.skill_rating.toFixed(2)} · {detail.wins}W – {detail.losses}L (
                  {detail.win_pct}%) · Diff{' '}
                  {detail.point_diff > 0 ? `+${detail.point_diff}` : detail.point_diff}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => handleDeletePlayer(detail.player_id)}
              >
                <Trash2 size={14} /> Remove
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setSelectedId(null)}
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="grid-2">
            <div>
              <div
                className="section-heading"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <UserCheck size={14} /> {lang === 'ja' ? 'パートナー別成績' : 'Record With Partners'}
              </div>
              {detail.teammates.length === 0 ? (
                <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
                  No doubles partner matches yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {detail.teammates.map((tm) => (
                    <div key={tm.other_player_id} className="rally-row">
                      <span style={{ fontWeight: 700 }}>{tm.other_name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {tm.wins}-{tm.losses} ({tm.win_pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div
                className="section-heading"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <Swords size={14} /> {lang === 'ja' ? '対戦相手別成績' : 'Head-to-Head vs Opponents'}
              </div>
              {detail.opponents.length === 0 ? (
                <div style={{ fontSize: '0.84rem', color: 'var(--ink-muted)' }}>
                  No completed opponent matchups yet.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {detail.opponents.map((o) => (
                    <div key={o.other_player_id} className="rally-row">
                      <span style={{ fontWeight: 700 }}>{o.other_name}</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                        {o.wins}-{o.losses} ({o.win_pct}%)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-backdrop" onClick={() => setShowModal(false)}>
          <div className="modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{t.addPlayer}</h2>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowModal(false)}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">

            <div className="field-group">
              <label className="field-label" htmlFor="p-name">
                Full Name
              </label>
              <input
                id="p-name"
                className="input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Alex Morgan"
              />
            </div>

            <div className="grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor="p-nick">
                  Court Nickname (optional)
                </label>
                <input
                  id="p-nick"
                  className="input"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  placeholder="Alex"
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="p-rating">
                  DUPR / Skill Rating
                </label>
                <input
                  id="p-rating"
                  type="number"
                  step="0.05"
                  min="1.0"
                  max="8.0"
                  className="input"
                  value={rating}
                  onChange={(e) => setRating(e.target.value)}
                />
              </div>
            </div>

            <div className="field-group">
              <span className="field-label">Badge Color</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: '50%',
                      background: c,
                      border: color === c ? '3px solid var(--ink-primary)' : '2px solid transparent',
                    }}
                    aria-label={`Select color ${c}`}
                  />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                id="btn-confirm-add-player"
                className="btn btn-primary"
                onClick={handleAddPlayer}
                disabled={saving}
              >
                Save Player
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

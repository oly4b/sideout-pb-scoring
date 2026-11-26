import { Plus, RefreshCw, Swords, Trash2, Trophy, UserCheck, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  computePlayerAttributes,
  computePlayerSituationalSplits,
  computePlayerSkillProfiles,
  MIN_RALLIES_FOR_ATTRIBUTES,
  RALLY_OUTCOME_TAGS,
} from '../../shared/pickleballEngine';
import { formatRating, MIN_MATCHES_FOR_RATING } from '../../shared/ratingEngine';
import { computePlayerDetailStats, computeStandings } from '../../shared/statsEngine';
import type { Match, Player, PlayerDetailStats, Session } from '../../shared/types';
import { api } from '../lib/api';
import { copy, type Lang } from '../lib/i18n';

interface PlayersViewProps {
  lang: Lang;
  players: Player[];
  matches: Match[];
  sessions: Session[];
  onRefreshAll: () => Promise<void>;
  onNotify: (msg: string) => void;
}

const SWATCHES = ['#1D4ED8', '#15803D', '#E25747', '#B45309', '#0E7490', '#BE185D', '#3F6212', '#132B4F'];

/** Player leaderboard, DUPR-style ratings, department skill breakdown, attributes, and matchup history. */
export function PlayersView({
  lang,
  players,
  matches,
  sessions,
  onRefreshAll,
  onNotify,
}: PlayersViewProps) {
  const t = copy[lang].players;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState('');
  const [rating, setRating] = useState('');
  const [color, setColor] = useState(SWATCHES[0]);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlayerDetailStats | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  const skillProfiles = useMemo(
    () => computePlayerSkillProfiles(players, matches),
    [players, matches]
  );
  const selectedSkill = selectedId ? skillProfiles.get(selectedId) ?? null : null;
  const situationalSplitsMap = useMemo(
    () => computePlayerSituationalSplits(players, matches, sessions),
    [players, matches, sessions]
  );
  const selectedSplits = selectedId ? situationalSplitsMap.get(selectedId) ?? null : null;

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
          skill_rating: null,
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
  const selectedAttributes =
    selectedSkill && detail ? computePlayerAttributes(selectedSkill, detail.games_played) : null;

  const handleAddPlayer = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      onNotify('Enter a player name');
      return;
    }
    const duplicate = players.some(
      (p) => p.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicate) {
      onNotify(
        lang === 'ja'
          ? `${trimmedName} はすでに登録されています`
          : `${trimmedName} is already in the roster`
      );
      return;
    }
    try {
      setSaving(true);
      const parsedRating = rating.trim()
        ? Math.min(8, Math.max(1, Number(rating)))
        : null;
      await api.createPlayer({
        name: name.trim(),
        nickname: nickname.trim() || undefined,
        skill_rating: Number.isFinite(parsedRating) ? parsedRating : null,
        avatar_color: color,
      });
      setName('');
      setNickname('');
      setRating('');
      setShowModal(false);
      await onRefreshAll();
      onNotify('Player added to roster');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to create player');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDeletePlayer = async () => {
    if (!deleteTarget) return;
    if (deleteConfirmText.trim().toUpperCase() !== 'DELETE') return;
    try {
      setDeleting(true);
      await api.deletePlayer(deleteTarget.player_id);
      setDeleteTarget(null);
      setDeleteConfirmText('');
      setSelectedId(null);
      await onRefreshAll();
      onNotify(lang === 'ja' ? 'プレイヤーを削除しました' : 'Player removed');
    } catch (err) {
      onNotify(err instanceof Error ? err.message : 'Failed to remove player');
    } finally {
      setDeleting(false);
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
                <th>{lang === 'ja' ? 'プレイヤー' : 'Player'}</th>
                <th className="num">{lang === 'ja' ? 'レーティング' : 'Rating'}</th>
                <th className="num">{lang === 'ja' ? '勝-敗' : 'W-L'}</th>
                <th className="num">{lang === 'ja' ? '勝率' : 'Win %'}</th>
                <th className="num">+/-</th>
                <th className="num">{lang === 'ja' ? '連勝/連敗' : 'Streak'}</th>
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
                  <td className="num">
                    <span style={{ fontWeight: 700 }}>{formatRating(row.skill_rating)}</span>
                    {typeof row.rating_delta === 'number' && row.rating_delta !== 0 && (
                      <span
                        style={{
                          marginLeft: 5,
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          color: row.rating_delta > 0 ? 'var(--brand-emerald)' : 'var(--danger)',
                        }}
                      >
                        {row.rating_delta > 0
                          ? `+${row.rating_delta.toFixed(2)}`
                          : row.rating_delta.toFixed(2)}
                      </span>
                    )}
                  </td>
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
                  Skill {formatRating(detail.skill_rating)} · {detail.wins}W – {detail.losses}L (
                  {detail.win_pct}%) · Diff{' '}
                  {detail.point_diff > 0 ? `+${detail.point_diff}` : detail.point_diff}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                id="btn-remove-player"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  setDeleteConfirmText('');
                  setDeleteTarget(detail);
                }}
              >
                <Trash2 size={14} /> {lang === 'ja' ? '削除' : 'Remove'}
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

          {selectedSkill && selectedSkill.ralliesPlayed > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: '12px 14px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <div className="section-heading" style={{ margin: 0 }}>
                {lang === 'ja' ? '部門別スキル分析' : 'Department Skill Breakdown'}
                <span style={{ fontWeight: 500, color: 'var(--ink-muted)', marginLeft: 8 }}>
                  {lang === 'ja'
                    ? `(${selectedSkill.ralliesPlayed}ラリー)`
                    : `(${selectedSkill.ralliesPlayed} rallies)`}
                </span>
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(135px, 1fr))',
                  gap: 8,
                }}
              >
                <div className="stat-card" style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', fontWeight: 700 }}>
                    {lang === 'ja' ? 'サーブ得点率' : 'Service Win %'}
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--team-a)' }}>
                    {selectedSkill.serveWinPct !== null ? `${selectedSkill.serveWinPct}%` : '—'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-secondary)' }}>
                    {selectedSkill.ptsPerServiceTurn !== null
                      ? `${selectedSkill.ptsPerServiceTurn} ${lang === 'ja' ? '点/回' : 'pts/turn'}`
                      : `${selectedSkill.serveWins}/${selectedSkill.servesTotal}`}
                  </div>
                </div>

                <div className="stat-card" style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', fontWeight: 700 }}>
                    {lang === 'ja' ? 'レシーブ勝率' : 'Receiving Win %'}
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--accent)' }}>
                    {selectedSkill.receiveWinPct !== null ? `${selectedSkill.receiveWinPct}%` : '—'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-secondary)' }}>
                    {selectedSkill.receiveWins}/{selectedSkill.receiveRallies}{' '}
                    {lang === 'ja' ? 'ブレイク' : 'breaks'}
                  </div>
                </div>

                <div className="stat-card" style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', fontWeight: 700 }}>
                    {lang === 'ja' ? '左右ボックス別' : 'Right / Left Box'}
                  </div>
                  <div style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--ink-primary)' }}>
                    {selectedSkill.rightSideWinPct !== null ? `${selectedSkill.rightSideWinPct}%` : '—'}
                    {' / '}
                    {selectedSkill.leftSideWinPct !== null ? `${selectedSkill.leftSideWinPct}%` : '—'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-secondary)' }}>
                    {lang === 'ja' ? '右(偶数) / 左(奇数)' : 'Even (R) / Odd (L)'}
                  </div>
                </div>

                <div className="stat-card" style={{ padding: '10px 12px' }}>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-muted)', fontWeight: 700 }}>
                    {lang === 'ja' ? '終盤クラッチ' : 'Clutch (8+)'}
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--team-b)' }}>
                    {selectedSkill.clutchWinPct !== null ? `${selectedSkill.clutchWinPct}%` : '—'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--ink-secondary)' }}>
                    {selectedSkill.clutchWins}/{selectedSkill.clutchRallies}{' '}
                    {lang === 'ja' ? 'ラリー' : 'rallies'}
                  </div>
                </div>
              </div>

              {Object.values(selectedSkill.tagCounts).some((v) => (v ?? 0) > 0) && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--ink-muted)' }}>
                    {lang === 'ja' ? 'ショット別記録:' : 'Shot Tags:'}
                  </span>
                  {RALLY_OUTCOME_TAGS.filter((t) => (selectedSkill.tagCounts[t.id] ?? 0) > 0).map((t) => (
                    <span key={t.id} className="tag tag-lime">
                      {lang === 'ja' ? t.ja : t.en} · {selectedSkill.tagCounts[t.id]}
                    </span>
                  ))}
                </div>
              )}

              {selectedAttributes && (
                <div
                  style={{
                    borderTop: '1px solid var(--border-subtle)',
                    paddingTop: 10,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  {!selectedAttributes.unlocked ? (
                    <div style={{ fontSize: '0.76rem', color: 'var(--ink-muted)', fontWeight: 600 }}>
                      {lang === 'ja'
                        ? `プレイスタイル解放条件: ${detail.games_played}/${MIN_MATCHES_FOR_RATING}試合 (レーティング解放) · ${selectedSkill.ralliesPlayed}/${MIN_RALLIES_FOR_ATTRIBUTES}ラリー`
                        : `Unlock playstyle attributes at ${MIN_MATCHES_FOR_RATING} rated games (${detail.games_played}/${MIN_MATCHES_FOR_RATING}) & ${MIN_RALLIES_FOR_ATTRIBUTES} rallies (${selectedSkill.ralliesPlayed}/${MIN_RALLIES_FOR_ATTRIBUTES})`}
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                        <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--ink-muted)' }}>
                          {lang === 'ja' ? 'プレイスタイル:' : 'Playstyle:'}
                        </span>
                        {selectedAttributes.badges.length === 0 ? (
                          <span className="tag">
                            {lang === 'ja' ? 'オールラウンダー' : 'All-Rounder'}
                          </span>
                        ) : (
                          selectedAttributes.badges.map((b) => (
                            <span key={b.id} className="tag tag-live">
                              {lang === 'ja' ? b.ja : b.en}
                            </span>
                          ))
                        )}
                        {selectedAttributes.missTendency === 'net' && (
                          <span className="tag tag-peach">
                            {lang === 'ja' ? '傾向: ネットミス多め' : 'Tendency: Net misses'}
                          </span>
                        )}
                        {selectedAttributes.missTendency === 'out' && (
                          <span className="tag tag-peach">
                            {lang === 'ja' ? '傾向: アウト多め' : 'Tendency: Long / Out misses'}
                          </span>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                          gap: 8,
                        }}
                      >
                        {(
                          [
                            {
                              key: 'serve',
                              label: lang === 'ja' ? 'サーブ' : 'Serve',
                              val: selectedAttributes.axes.serve,
                              color: 'var(--team-a)',
                            },
                            {
                              key: 'receive',
                              label: lang === 'ja' ? 'レシーブ' : 'Return',
                              val: selectedAttributes.axes.receive,
                              color: 'var(--accent)',
                            },
                            {
                              key: 'clutch',
                              label: lang === 'ja' ? 'クラッチ' : 'Clutch',
                              val: selectedAttributes.axes.clutch,
                              color: 'var(--team-b)',
                            },
                            {
                              key: 'consistency',
                              label: lang === 'ja' ? '安定性' : 'Consistency',
                              val: selectedAttributes.axes.consistency,
                              color: 'var(--brand-emerald)',
                            },
                          ] as const
                        ).map((axis) => (
                          <div key={axis.key} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                fontSize: '0.72rem',
                                fontWeight: 700,
                              }}
                            >
                              <span style={{ color: 'var(--ink-secondary)' }}>{axis.label}</span>
                              <span style={{ color: 'var(--ink-primary)' }}>
                                {axis.val !== null ? axis.val : '—'}
                              </span>
                            </div>
                            <div
                              style={{
                                height: 5,
                                borderRadius: 999,
                                background: 'rgba(148, 163, 184, 0.2)',
                                overflow: 'hidden',
                              }}
                            >
                              {axis.val !== null && (
                                <div
                                  style={{
                                    width: `${axis.val}%`,
                                    height: '100%',
                                    background: axis.color,
                                  }}
                                />
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {selectedSplits &&
            (selectedSplits.indoor.wins + selectedSplits.indoor.losses > 0 ||
              selectedSplits.outdoor.wins + selectedSplits.outdoor.losses > 0 ||
              selectedSplits.earlyRounds.wins + selectedSplits.earlyRounds.losses > 0 ||
              selectedSplits.lateRounds.wins + selectedSplits.lateRounds.losses > 0 ||
              selectedSplits.underdog.wins + selectedSplits.underdog.losses > 0) && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '12px 14px',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-subtle)',
                  border: '1px solid var(--border-subtle)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div className="section-heading" style={{ margin: 0 }}>
                    {lang === 'ja' ? '環境・状況別成績' : 'Situational & Environment Splits'}
                  </div>
                  {selectedSplits.isGiantKiller && (
                    <span className="tag tag-live">
                      {lang === 'ja' ? 'ジャイアントキラー' : 'Giant-Killer'}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {selectedSplits.indoor.wins + selectedSplits.indoor.losses > 0 && (
                    <span className="tag">
                      {lang === 'ja' ? '屋内' : 'Indoor'}: {selectedSplits.indoor.wins}-
                      {selectedSplits.indoor.losses} ({selectedSplits.indoor.winPct}%)
                    </span>
                  )}
                  {selectedSplits.outdoor.wins + selectedSplits.outdoor.losses > 0 && (
                    <span className="tag">
                      {lang === 'ja' ? '屋外' : 'Outdoor'}: {selectedSplits.outdoor.wins}-
                      {selectedSplits.outdoor.losses} ({selectedSplits.outdoor.winPct}%)
                    </span>
                  )}
                  {selectedSplits.earlyRounds.wins + selectedSplits.earlyRounds.losses > 0 &&
                    selectedSplits.lateRounds.wins + selectedSplits.lateRounds.losses > 0 && (
                      <span className="tag">
                        {lang === 'ja' ? '体力(序盤/終盤)' : 'Stamina (R1-2 / R4+)'}:{' '}
                        {selectedSplits.earlyRounds.winPct}% / {selectedSplits.lateRounds.winPct}%
                      </span>
                    )}
                  {selectedSplits.sideOut.wins + selectedSplits.sideOut.losses > 0 &&
                    selectedSplits.rallyMode.wins + selectedSplits.rallyMode.losses > 0 && (
                      <span className="tag">
                        {lang === 'ja' ? 'サイドアウト/ラリー' : 'Side-Out / Rally'}:{' '}
                        {selectedSplits.sideOut.winPct}% / {selectedSplits.rallyMode.winPct}%
                      </span>
                    )}
                  {selectedSplits.underdog.wins + selectedSplits.underdog.losses > 0 && (
                    <span className="tag tag-peach">
                      {lang === 'ja' ? '格上相手' : 'vs Higher-Rated'}:{' '}
                      {selectedSplits.underdog.wins}-{selectedSplits.underdog.losses} (
                      {selectedSplits.underdog.winPct}%)
                    </span>
                  )}
                </div>
              </div>
            )}

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
                  {detail.teammates.map((tm) => {
                    const synergy = selectedSplits?.partnerSynergy.get(tm.other_player_id);
                    return (
                      <div key={tm.other_player_id} className="rally-row">
                        <span style={{ fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          {tm.other_name}
                          {synergy !== undefined && Math.abs(synergy) >= 5 && (
                            <span
                              className={`tag ${synergy > 0 ? 'tag-lime' : ''}`}
                              style={{ fontSize: '0.68rem', padding: '1px 6px' }}
                            >
                              {synergy > 0 ? `+${synergy}%` : `${synergy}%`}{' '}
                              {lang === 'ja' ? '相性' : 'synergy'}
                            </span>
                          )}
                        </span>
                        <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                          {tm.wins}-{tm.losses} ({tm.win_pct}%)
                        </span>
                      </div>
                    );
                  })}
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
              <span className="field-label">{lang === 'ja' ? 'バッジカラー' : 'Badge Color'}</span>
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
      {deleteTarget && (
        <div
          className="modal-backdrop"
          onClick={() => {
            if (!deleting) setDeleteTarget(null);
          }}
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--danger)' }}>
                <Trash2 size={18} />
                <h2 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>
                  {lang === 'ja' ? 'プレイヤー削除の確認' : 'Confirm Player Removal'}
                </h2>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <p style={{ margin: 0, fontSize: '0.88rem', lineHeight: 1.5 }}>
                {lang === 'ja' ? (
                  <>
                    <strong>{deleteTarget.name}</strong> をロスターから削除します。この操作は取り消せません。
                  </>
                ) : (
                  <>
                    You are about to permanently remove <strong>{deleteTarget.name}</strong> from
                    the roster. This cannot be undone.
                  </>
                )}
              </p>
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--danger-soft)',
                  border: '1px solid rgba(225, 29, 72, 0.25)',
                  fontSize: '0.8rem',
                  color: 'var(--danger)',
                  fontWeight: 700,
                }}
              >
                {lang === 'ja'
                  ? `戦績: ${deleteTarget.games_played}試合（${deleteTarget.wins}勝 ${deleteTarget.losses}敗）。過去の試合参加記録も削除されます。`
                  : `Record: ${deleteTarget.games_played} match(es) (${deleteTarget.wins}W – ${deleteTarget.losses}L). Match participation links will also be removed.`}
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="delete-player-confirm">
                  {lang === 'ja'
                    ? '続行するには DELETE と入力してください'
                    : 'Type DELETE to confirm'}
                </label>
                <input
                  id="delete-player-confirm"
                  type="text"
                  className="input"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="DELETE"
                  autoComplete="off"
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleting}
                >
                  {lang === 'ja' ? 'キャンセル' : 'Cancel'}
                </button>
                <button
                  type="button"
                  id="btn-confirm-delete-player"
                  className="btn btn-danger"
                  onClick={() => void handleConfirmDeletePlayer()}
                  disabled={deleting || deleteConfirmText.trim().toUpperCase() !== 'DELETE'}
                >
                  <Trash2 size={15} />{' '}
                  {lang === 'ja' ? '完全に削除する' : 'Remove Player'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

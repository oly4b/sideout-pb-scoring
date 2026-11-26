import type { Match, RallyOutcomeTag } from '../../shared/types';
import {
  computeMatchAnalytics,
  getMatchRalliesWithTags,
  RALLY_OUTCOME_TAGS,
} from '../../shared/pickleballEngine';
import type { Lang } from '../lib/i18n';

interface MatchAnalyticsPanelProps {
  match: Match;
  lang: Lang;
  compact?: boolean;
}

function ComparisonRow({
  label,
  subLabel,
  leftValue,
  rightValue,
  leftPct,
  rightPct,
  leftMetric,
  rightMetric,
}: {
  label: string;
  subLabel?: string;
  leftValue: string;
  rightValue: string;
  leftPct?: number;
  rightPct?: number;
  leftMetric?: number | null;
  rightMetric?: number | null;
}) {
  const showBar = leftPct !== undefined && rightPct !== undefined && leftPct + rightPct > 0;
  const total = showBar ? leftPct + rightPct : 1;
  const leftWidth = showBar ? Math.round((leftPct / total) * 100) : 50;

  const cmpLeft = leftMetric !== undefined ? leftMetric : leftPct;
  const cmpRight = rightMetric !== undefined ? rightMetric : rightPct;
  const hasWinner =
    cmpLeft !== null &&
    cmpLeft !== undefined &&
    cmpRight !== null &&
    cmpRight !== undefined &&
    cmpLeft !== cmpRight;
  const leftOpacity = hasWinner && cmpLeft < cmpRight ? 0.5 : 1;
  const rightOpacity = hasWinner && cmpRight < cmpLeft ? 0.5 : 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto 1fr',
          alignItems: 'baseline',
          gap: 8,
          fontSize: '0.8rem',
        }}
      >
        <span
          style={{
            fontWeight: 700,
            color: 'var(--team-a)',
            textAlign: 'left',
            opacity: leftOpacity,
          }}
        >
          {leftValue}
        </span>
        <span style={{ color: 'var(--ink-secondary)', fontWeight: 600, textAlign: 'center' }}>
          {label}
          {subLabel && (
            <span style={{ color: 'var(--ink-muted)', fontWeight: 500, marginLeft: 4 }}>
              {subLabel}
            </span>
          )}
        </span>
        <span
          style={{
            fontWeight: 700,
            color: 'var(--team-b)',
            textAlign: 'right',
            opacity: rightOpacity,
          }}
        >
          {rightValue}
        </span>
      </div>
      {showBar && (
        <div
          style={{
            height: 5,
            borderRadius: 'var(--radius-pill)',
            background: 'rgba(249, 115, 22, 0.25)',
            overflow: 'hidden',
            display: 'flex',
          }}
        >
          <div
            style={{
              width: `${leftWidth}%`,
              background: 'var(--team-a)',
              opacity: leftOpacity,
              height: '100%',
              transition: 'width 0.25s ease',
            }}
          />
          <div
            style={{
              flex: 1,
              background: 'var(--team-b)',
              opacity: rightOpacity,
              height: '100%',
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Displays head-to-head match analytics, serve/side-out rates, streaks, and tagged rally endings. */
export function MatchAnalyticsPanel({ match, lang, compact = false }: MatchAnalyticsPanelProps) {
  const rallies = getMatchRalliesWithTags(match);
  if (rallies.length === 0) return null;

  const a = computeMatchAnalytics(match);
  const tagCounts = new Map<RallyOutcomeTag, number>();
  for (const r of rallies) {
    if (r.outcome_tag) {
      tagCounts.set(r.outcome_tag, (tagCounts.get(r.outcome_tag) ?? 0) + 1);
    }
  }
  const isJa = lang === 'ja';
  const showServerSplit =
    match.game_type === 'doubles' &&
    match.scoring_mode === 'side_out' &&
    (a.teamA.server2Serves > 0 || a.teamB.server2Serves > 0);

  const fmtPct = (pct: number | null) => (pct === null ? '—' : `${pct}%`);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
        }}
      >
        <div className="section-heading" style={{ margin: 0 }}>
          {isJa ? '試合アナリティクス' : 'Match Analytics'}
        </div>
        <span style={{ fontSize: '0.75rem', color: 'var(--ink-muted)', fontWeight: 600 }}>
          {isJa ? `全${a.totalRallies}ラリー` : `${a.totalRallies} total rallies`}
          {a.avgRallySeconds !== null
            ? ` · ${a.avgRallySeconds}s/${isJa ? 'ラリー' : 'rally'}`
            : ''}
        </span>
      </div>

      {/* Head-to-head metrics */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          padding: compact ? '10px 12px' : '12px 14px',
          borderRadius: 'var(--radius-md)',
          background: 'var(--bg-subtle)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.74rem',
            fontWeight: 800,
            letterSpacing: '0.02em',
          }}
        >
          <span style={{ color: 'var(--team-a)' }}>{match.team_a_name}</span>
          <span style={{ color: 'var(--team-b)' }}>{match.team_b_name}</span>
        </div>

        <ComparisonRow
          label={isJa ? 'ラリー獲得' : 'Rallies Won'}
          leftValue={`${a.teamA.ralliesWon} (${a.teamA.rallyWinPct}%)`}
          rightValue={`${a.teamB.ralliesWon} (${a.teamB.rallyWinPct}%)`}
          leftPct={a.teamA.ralliesWon}
          rightPct={a.teamB.ralliesWon}
        />

        <ComparisonRow
          label={isJa ? 'サーブ得点率' : 'Serve Win %'}
          leftValue={
            a.teamA.serveWinPct !== null
              ? `${fmtPct(a.teamA.serveWinPct)} (${a.teamA.serveWins}/${a.teamA.servesTotal})`
              : '—'
          }
          rightValue={
            a.teamB.serveWinPct !== null
              ? `${fmtPct(a.teamB.serveWinPct)} (${a.teamB.serveWins}/${a.teamB.servesTotal})`
              : '—'
          }
          leftPct={a.teamA.serveWinPct ?? 0}
          rightPct={a.teamB.serveWinPct ?? 0}
          leftMetric={a.teamA.serveWinPct}
          rightMetric={a.teamB.serveWinPct}
        />

        <ComparisonRow
          label={
            match.scoring_mode === 'side_out'
              ? isJa
                ? 'レシーブ勝率 / サイドアウト'
                : 'Break % / Side-Outs'
              : isJa
                ? 'レシーブ勝率'
                : 'Receive Win %'
          }
          leftValue={
            a.teamA.receiveWinPct !== null
              ? match.scoring_mode === 'side_out'
                ? `${fmtPct(a.teamA.receiveWinPct)} (${a.teamA.sideOuts})`
                : `${fmtPct(a.teamA.receiveWinPct)}`
              : '—'
          }
          rightValue={
            a.teamB.receiveWinPct !== null
              ? match.scoring_mode === 'side_out'
                ? `${fmtPct(a.teamB.receiveWinPct)} (${a.teamB.sideOuts})`
                : `${fmtPct(a.teamB.receiveWinPct)}`
              : '—'
          }
          leftPct={a.teamA.receiveWinPct ?? 0}
          rightPct={a.teamB.receiveWinPct ?? 0}
          leftMetric={a.teamA.receiveWinPct}
          rightMetric={a.teamB.receiveWinPct}
        />

        <ComparisonRow
          label={isJa ? '平均得点 / サーブ権' : 'Pts / Possession'}
          leftValue={a.teamA.ptsPerPossession !== null ? `${a.teamA.ptsPerPossession}` : '—'}
          rightValue={a.teamB.ptsPerPossession !== null ? `${a.teamB.ptsPerPossession}` : '—'}
          leftMetric={a.teamA.ptsPerPossession}
          rightMetric={a.teamB.ptsPerPossession}
        />

        {showServerSplit && (
          <ComparisonRow
            label={isJa ? 'サーバー別勝率 (1番/2番)' : 'Server 1 / 2'}
            leftValue={`${a.teamA.server1Wins}/${a.teamA.server1Serves} · ${a.teamA.server2Wins}/${a.teamA.server2Serves}`}
            rightValue={`${a.teamB.server1Wins}/${a.teamB.server1Serves} · ${a.teamB.server2Wins}/${a.teamB.server2Serves}`}
            leftMetric={
              a.teamA.server1Serves + a.teamA.server2Serves > 0
                ? (a.teamA.server1Wins + a.teamA.server2Wins) /
                  (a.teamA.server1Serves + a.teamA.server2Serves)
                : null
            }
            rightMetric={
              a.teamB.server1Serves + a.teamB.server2Serves > 0
                ? (a.teamB.server1Wins + a.teamB.server2Wins) /
                  (a.teamB.server1Serves + a.teamB.server2Serves)
                : null
            }
          />
        )}

        <ComparisonRow
          label={isJa ? '最長連続得点' : 'Longest Run'}
          leftValue={`${a.teamA.longestPointRun}-0`}
          rightValue={`${a.teamB.longestPointRun}-0`}
          leftMetric={a.teamA.longestPointRun}
          rightMetric={a.teamB.longestPointRun}
        />

        <ComparisonRow
          label={isJa ? '最大リード' : 'Max Lead'}
          leftValue={a.teamA.maxLead > 0 ? `+${a.teamA.maxLead}` : '0'}
          rightValue={a.teamB.maxLead > 0 ? `+${a.teamB.maxLead}` : '0'}
          leftMetric={a.teamA.maxLead}
          rightMetric={a.teamB.maxLead}
        />

        {(a.teamA.gamePointsFaced > 0 || a.teamB.gamePointsFaced > 0) && (
          <ComparisonRow
            label={isJa ? 'ゲームポイント阻止' : 'Game Pts Saved'}
            leftValue={
              a.teamA.gamePointsFaced > 0
                ? `${a.teamA.gamePointsSaved}/${a.teamA.gamePointsFaced}`
                : '—'
            }
            rightValue={
              a.teamB.gamePointsFaced > 0
                ? `${a.teamB.gamePointsSaved}/${a.teamB.gamePointsFaced}`
                : '—'
            }
            leftMetric={
              a.teamA.gamePointsFaced > 0
                ? a.teamA.gamePointsSaved / a.teamA.gamePointsFaced
                : null
            }
            rightMetric={
              a.teamB.gamePointsFaced > 0
                ? a.teamB.gamePointsSaved / a.teamB.gamePointsFaced
                : null
            }
          />
        )}
      </div>

      {/* Match dynamics badges */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <span className="tag">
          {isJa ? `リード交代 ${a.leadChanges}回` : `Lead changes: ${a.leadChanges}`}
        </span>
        <span className="tag">{isJa ? `同点 ${a.ties}回` : `Ties: ${a.ties}`}</span>
        {a.biggestComeback && (
          <span className="tag">
            {isJa
              ? `最大逆転: ${a.biggestComeback.team === 'A' ? match.team_a_name : match.team_b_name} (-${a.biggestComeback.deficit})`
              : `Comeback: ${a.biggestComeback.team === 'A' ? match.team_a_name : match.team_b_name} (-${a.biggestComeback.deficit})`}
          </span>
        )}
        {a.clutchRallies > 0 && (
          <span className="tag">
            {isJa
              ? `終盤接戦: ${a.clutchWinsA}-${a.clutchWinsB}`
              : `Clutch (${Math.max(1, match.target_score - 3)}+): ${a.clutchWinsA}-${a.clutchWinsB}`}
          </span>
        )}
        {a.preSwitch && a.postSwitch && (
          <span className="tag">
            {isJa
              ? `折り返し(${a.switchTarget})前 ${a.preSwitch.pointsA}-${a.preSwitch.pointsB} / 後 ${a.postSwitch.pointsA}-${a.postSwitch.pointsB}`
              : `Pre-@${a.switchTarget}: ${a.preSwitch.pointsA}-${a.preSwitch.pointsB} · Post: ${a.postSwitch.pointsA}-${a.postSwitch.pointsB}`}
          </span>
        )}
      </div>

      {tagCounts.size > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: '0.74rem', fontWeight: 700, color: 'var(--ink-muted)' }}>
            {isJa ? '決着内訳:' : 'Rally Endings:'}
          </span>
          {RALLY_OUTCOME_TAGS.filter((t) => (tagCounts.get(t.id) ?? 0) > 0).map((t) => (
            <span key={t.id} className="tag tag-lime">
              {isJa ? t.ja : t.en} · {tagCounts.get(t.id)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

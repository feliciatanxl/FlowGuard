// AI Accuracy Rate — a meter, not a donut: the dataviz guidance is explicit that "a
// single ratio against a limit" takes a meter, never a pie of 2 slices. Fill tiers by
// value (accent/warning/danger) using the app's existing accent vocabulary; the track
// is a lighter step of the same card-border tone so the bar reads across its full width.
const AccuracyMeter = ({ accuracy }) => {
  const hasData = accuracy.evaluatedCount > 0;
  const pctLabel = hasData ? `${accuracy.accuracyPct.toFixed(1)}%` : '—';

  return (
    <div className="ia-stat-tile">
      <div className="ia-stat-label">AI Accuracy Rate</div>
      <div className="ia-stat-value">{pctLabel}</div>
      <div
        className="ia-meter"
        role="img"
        aria-label={
          hasData
            ? `AI accuracy rate: ${accuracy.accuracyPct.toFixed(1)} percent, based on ${accuracy.evaluatedCount} evaluated AI incidents`
            : 'AI accuracy rate: no evaluated AI incidents yet'
        }
      >
        <div
          className={`ia-meter-fill ia-meter-fill-${accuracy.tier}`}
          style={{ width: `${hasData ? accuracy.accuracyPct : 0}%` }}
        />
      </div>
      <div className="ia-stat-sublabel">
        {accuracy.evaluatedCount} evaluated AI incident{accuracy.evaluatedCount === 1 ? '' : 's'} ({accuracy.falsePositiveCount} false positive)
      </div>
    </div>
  );
};

export default AccuracyMeter;

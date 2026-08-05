// Mean Time To Resolve — a stat tile (headline value + small sparkline), not a full
// trend-line chart: this is "a single current value + maybe a trend," the textbook
// stat-tile case. Single series, so no legend box is needed — the tile's own label
// already names what's plotted.
const MTTRStatTile = ({ mttr }) => (
  <div className="ia-stat-tile">
    <div className="ia-stat-label">Avg. Resolution Time</div>
    <div className="ia-stat-value">{mttr.avgLabel}</div>
    <div
      className="ia-sparkline"
      role="img"
      aria-label={`Average resolution time trend over the last 7 days: ${mttr.trend.map((t) => `${t.label} ${t.avgLabel}`).join(', ')}`}
    >
      {mttr.trend.map((t, i) => (
        <div
          key={t.date}
          className={`ia-sparkline-bar${i === mttr.trend.length - 1 ? ' ia-sparkline-bar-current' : ''}`}
          style={{ height: `${mttr.trendMax ? (t.avgMs / mttr.trendMax) * 100 : 0}%` }}
          title={`${t.label}: ${t.avgLabel}`}
        />
      ))}
    </div>
    <div className="ia-stat-sublabel">{mttr.resolvedCount} resolved incident{mttr.resolvedCount === 1 ? '' : 's'}</div>
    <table className="sr-only">
      <caption>Average resolution time per day (last 7 days)</caption>
      <thead><tr><th scope="col">Day</th><th scope="col">Avg. resolution time</th></tr></thead>
      <tbody>
        {mttr.trend.map((t) => (
          <tr key={`row-${t.date}`}><th scope="row">{t.label}</th><td>{t.avgLabel}</td></tr>
        ))}
      </tbody>
    </table>
  </div>
);

export default MTTRStatTile;

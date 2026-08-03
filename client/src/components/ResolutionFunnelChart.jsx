// Escalation & Resolution Funnel — resolutionStatus here is a literal ORDINAL
// sequence (Active -> Investigating -> Escalated to Security -> Cleared), the
// textbook case for one hue with monotone lightness steps rather than 4 arbitrary
// categorical colors. Each stage is directly labeled by name, so no separate legend
// box is needed. Reuses the same accessible horizontal-bar structure as
// TopAlertZonesChart.jsx (.zones-list/.zone-row/.zone-bar-track/.zone-bar).
const FUNNEL_COLORS = {
  Active: '#86b6ef',
  Investigating: '#5598e7',
  'Escalated to Security': '#2a78d6',
  Cleared: '#1c5cab',
};

const ResolutionFunnelChart = ({ funnel }) => {
  const max = Math.max(...funnel.stages.map((s) => s.count), 1);

  return (
    <section className="analytics-panel" aria-labelledby="funnel-heading">
      <div className="analytics-panel-head">
        <h3 id="funnel-heading">Escalation &amp; Resolution Funnel</h3>
        <span className="analytics-subtle" aria-hidden="true">Current incidents by stage</span>
      </div>

      <ul className="zones-list">
        {funnel.stages.map((s) => (
          <li className="zone-row" key={s.stage}>
            <span className="zone-name">{s.stage}</span>
            <span className="zone-bar-track" aria-hidden="true">
              <span
                className="zone-bar"
                style={{ width: `${(s.count / max) * 100}%`, background: FUNNEL_COLORS[s.stage] }}
              />
            </span>
            <span className="zone-count" aria-label={`${s.stage}: ${s.count}`}>{s.count}</span>
          </li>
        ))}
      </ul>

      {/* False Positive is a separate terminal branch off the funnel, not a 5th
          sequential stage — shown as a set-apart aside row rather than omitted. */}
      <div className="ia-funnel-aside">
        <span className="zone-name">False Positive <span className="analytics-subtle">(separate branch)</span></span>
        <span className="ia-funnel-aside-count">{funnel.falsePositiveCount}</span>
      </div>

      <table className="sr-only">
        <caption>Incidents by resolution stage</caption>
        <thead><tr><th scope="col">Stage</th><th scope="col">Count</th></tr></thead>
        <tbody>
          {funnel.stages.map((s) => (
            <tr key={`row-${s.stage}`}><th scope="row">{s.stage}</th><td>{s.count}</td></tr>
          ))}
          <tr><th scope="row">False Positive (separate branch)</th><td>{funnel.falsePositiveCount}</td></tr>
        </tbody>
      </table>
    </section>
  );
};

export default ResolutionFunnelChart;

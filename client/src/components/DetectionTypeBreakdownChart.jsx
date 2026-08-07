// Detection Type Breakdown — incident counts grouped by detection type
// (incident.status), covering both the fixed built-in categories and any
// free-text custom types FM staff have logged via "Other / Custom...". This is
// a magnitude comparison across NOMINAL categories (type order carries no
// meaning), so it takes the same single-hue treatment as TopAlertZonesChart —
// color compares "how many", not identity, so every bar shares one hue.
const DetectionTypeBreakdownChart = ({ breakdown }) => {
  const types = Array.isArray(breakdown) ? breakdown : [];
  const max = types.reduce((m, t) => Math.max(m, t.count), 0) || 1;

  return (
    <section className="analytics-panel" aria-labelledby="detection-type-heading">
      <div className="analytics-panel-head">
        <h3 id="detection-type-heading">Detection Type Breakdown</h3>
        <span className="analytics-subtle" aria-hidden="true">All incidents, built-in and custom types</span>
      </div>

      {types.length === 0 ? (
        <p className="analytics-empty">No incidents logged yet.</p>
      ) : (
        <ul className="zones-list">
          {types.map((t) => (
            <li className="zone-row" key={t.type}>
              <span className="zone-name" title={t.type}>{t.type}</span>
              <span className="zone-bar-track" aria-hidden="true">
                <span className="zone-bar" style={{ width: `${(t.count / max) * 100}%` }} />
              </span>
              <span className="zone-count" aria-label={`${t.type}: ${t.count}`}>{t.count}</span>
            </li>
          ))}
        </ul>
      )}

      <table className="sr-only">
        <caption>Incident counts by detection type</caption>
        <thead><tr><th scope="col">Detection type</th><th scope="col">Count</th></tr></thead>
        <tbody>
          {types.map((t) => (
            <tr key={`row-${t.type}`}><th scope="row">{t.type}</th><td>{t.count}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};

export default DetectionTypeBreakdownChart;

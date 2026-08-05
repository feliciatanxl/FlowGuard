// AI Confidence vs. Outcome — a horizontal stacked bar per confidence-score bucket
// (part-to-whole). Valid vs. false-positive is a good/bad judgment, so it takes the
// fixed status color pair (never arbitrary categorical hues), always paired with an
// icon + label so the color never carries meaning alone.
const ConfidenceBucketChart = ({ buckets }) => (
  <section className="analytics-panel" aria-labelledby="confidence-bucket-heading">
    <div className="analytics-panel-head">
      <h3 id="confidence-bucket-heading">AI Confidence vs. Outcome</h3>
      <div className="analytics-legend" aria-hidden="true">
        <span className="legend-item"><span className="legend-swatch ia-legend-valid" /> ✓ Valid</span>
        <span className="legend-item"><span className="legend-swatch ia-legend-fp" /> ✕ False Positive</span>
      </div>
    </div>

    {buckets.every((b) => b.valid + b.falsePositive === 0) ? (
      <p className="analytics-empty">No adjudicated AI incidents with a recorded confidence score yet.</p>
    ) : (
      <ul className="zones-list">
        {buckets.map((b) => {
          const total = b.valid + b.falsePositive || 1;
          return (
            <li className="zone-row ia-confidence-row" key={b.bucket}>
              <span className="zone-name">{b.bucket}</span>
              <span className="zone-bar-track ia-confidence-track" aria-hidden="true">
                {b.valid > 0 && (
                  <span
                    className="ia-confidence-segment ia-confidence-valid"
                    style={{ width: `${(b.valid / total) * 100}%` }}
                    title={`Valid: ${b.valid}`}
                  />
                )}
                {b.falsePositive > 0 && (
                  <span
                    className="ia-confidence-segment ia-confidence-fp"
                    style={{ width: `${(b.falsePositive / total) * 100}%` }}
                    title={`False Positive: ${b.falsePositive}`}
                  />
                )}
              </span>
              <span className="zone-count" aria-label={`${b.bucket}: ${b.valid} valid, ${b.falsePositive} false positive`}>
                {b.valid + b.falsePositive}
              </span>
            </li>
          );
        })}
      </ul>
    )}

    <table className="sr-only">
      <caption>AI confidence score buckets vs. valid/false-positive outcome</caption>
      <thead><tr><th scope="col">Confidence bucket</th><th scope="col">Valid</th><th scope="col">False Positive</th></tr></thead>
      <tbody>
        {buckets.map((b) => (
          <tr key={`row-${b.bucket}`}>
            <th scope="row">{b.bucket}</th>
            <td>{b.valid}</td>
            <td>{b.falsePositive}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </section>
);

export default ConfidenceBucketChart;

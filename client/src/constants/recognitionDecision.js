// Shared recognition decision states used by the live decision card and the
// facial-evaluation screens. Kept in its own module so both a component
// (RecognitionDecisionCard) and non-component consumers (FacialEvaluation) can
// import it without breaking React Fast Refresh's component-only-export rule.
export const DECISION_STATES = {
  NO_FACE: 'NO_FACE',
  GRANTED: 'GRANTED',
  SUSPENDED: 'SUSPENDED',
  UNKNOWN: 'UNKNOWN'
};

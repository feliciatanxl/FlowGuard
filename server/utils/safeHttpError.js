const PUBLIC_INTERNAL_ERROR = 'Unable to process the request.';

// Log the complete error for operators while returning one stable response that
// cannot expose SQL, schema, host, credential, or upstream-service details.
const sendUnexpectedError = (res, context, error) => {
  console.error(context, error);
  return res.status(500).json({ error: PUBLIC_INTERNAL_ERROR });
};

module.exports = { PUBLIC_INTERNAL_ERROR, sendUnexpectedError };

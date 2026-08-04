export const describeWhatsapp = (result) => {
  if (!result) return '';
  const recipientName = result.recipientName || 'Driver';
  const recipientPhone = result.recipientPhoneMasked || '(number unavailable)';
  const recipient = `${recipientName} (${recipientPhone})`;
  if (result.simulated) return `WhatsApp simulated for ${recipient}.`;
  if (result.success) return `WhatsApp sent to ${recipient}.`;
  return `WhatsApp delivery pending for ${recipient}.`;
};

export const buildBookingNotice = (base, response = {}) => {
  const details = [describeWhatsapp(response.whatsapp)];
  if (response.nextInLineWhatsapp) {
    details.push(`Next in line: ${describeWhatsapp(response.nextInLineWhatsapp)}`);
  }
  return [base, ...details.filter(Boolean)].join(' ');
};

const formatKey = (keyStr, options, questionType) => {
  // Handle numerical types first — they store plain values, not JSON-wrapped option references
  const isNumerical = questionType === 'numerical_integer' || questionType === 'numerical_decimal';
  if (isNumerical) {
    if (keyStr === null || keyStr === undefined) return 'N/A';
    const str = String(keyStr).trim();
    return str.length > 0 ? str : 'N/A';
  }

  if (!keyStr) return 'N/A';

  let list = [];
  try {
    const parsed = JSON.parse(keyStr);
    list = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    list = [keyStr];
  }

  // Helper to parse options
  const parseOption = (opt) => {
    if (typeof opt !== 'string') return { text: '', image_url: '', image_public_id: '' };
    const trimmed = opt.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      try {
        const parsed = JSON.parse(trimmed);
        return {
          text: parsed.text || '',
          image_url: parsed.image_url || '',
          image_public_id: parsed.image_public_id || ''
        };
      } catch (e) {}
    }
    return { text: opt, image_url: '', image_public_id: '' };
  };

  const areOptionsEqual = (optA, optB) => {
    if (optA === optB) return true;
    const normA = (parseOption(optA).text || '').trim().toLowerCase() || (parseOption(optA).image_url || '').trim().toLowerCase();
    const normB = (parseOption(optB).text || '').trim().toLowerCase() || (parseOption(optB).image_url || '').trim().toLowerCase();
    return normA === normB;
  };

  if (options && Array.isArray(options) && options.length > 0) {
    const labels = [];
    list.forEach(item => {
      const idx = options.findIndex(opt => areOptionsEqual(opt, item));
      if (idx !== -1) {
        labels.push(String.fromCharCode(65 + idx)); // 'A', 'B', etc.
      } else {
        const text = parseOption(item).text;
        if (text) labels.push(text);
      }
    });
    if (labels.length > 0) return labels.join(', ');
  }

  return list.map(item => {
    const parsed = parseOption(item);
    return parsed.text || (parsed.image_url ? '[Image]' : '');
  }).filter(Boolean).join(', ') || 'N/A';
};

console.log("numerical_integer 55:", formatKey('55', null, 'numerical_integer'));
console.log("numerical_decimal 9.8:", formatKey('9.8', null, 'numerical_decimal'));
console.log("numerical_integer null:", formatKey(null, null, 'numerical_integer'));
console.log("numerical_integer undefined:", formatKey(undefined, null, 'numerical_integer'));
console.log("numerical_integer 0:", formatKey(0, null, 'numerical_integer'));
console.log("numerical_integer range 1-2:", formatKey('1-2', null, 'numerical_integer'));

const fs = require('fs');
const path = require('path');

// Manually parse .env file
const envPath = path.join(__dirname, '../.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let key = match[1];
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) {
      value = value.substring(1, value.length - 1);
    } else if (value.startsWith("'") && value.endsWith("'")) {
      value = value.substring(1, value.length - 1);
    }
    env[key] = value.trim();
  }
});

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

// Copy functions from ReviewSubmission.jsx
const parseOption = (opt) => {
  if (opt === null || opt === undefined) return { text: '', image_url: '', image_public_id: '' };
  if (typeof opt !== 'string') {
    return { text: String(opt), image_url: '', image_public_id: '' };
  }
  const trimmed = opt.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      return {
        text: parsed.text !== undefined && parsed.text !== null ? String(parsed.text) : '',
        image_url: parsed.image_url || '',
        image_public_id: parsed.image_public_id || ''
      };
    } catch (e) {}
  }
  return { text: opt, image_url: '', image_public_id: '' };
};

const normalizeOptionForComparison = (opt) => {
  const parsed = parseOption(opt);
  const val = parsed.text.trim() || parsed.image_url.trim();
  return val.toLowerCase();
};

const areOptionsEqual = (optA, optB) => {
  return normalizeOptionForComparison(optA) === normalizeOptionForComparison(optB);
};

const formatKey = (keyStr, options, questionType) => {
  if (!keyStr) return 'N/A';
  
  const isNumerical = questionType === 'numerical_integer' || questionType === 'numerical_decimal';
  if (isNumerical) {
    return String(keyStr);
  }

  let list = [];
  try {
    const parsed = JSON.parse(keyStr);
    list = Array.isArray(parsed) ? parsed : [parsed];
  } catch (e) {
    list = [keyStr];
  }

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

async function run() {
  try {
    const examId = '2ec50182-b579-4ee0-83f8-bcbf46942ede';
    const url = `${supabaseUrl}/rest/v1/questions?exam_id=eq.${examId}&order=order_index.asc`;
    const res = await fetch(url, {
      headers: {
        'apikey': supabaseAnonKey,
        'Authorization': `Bearer ${supabaseAnonKey}`,
        'Content-Type': 'application/json'
      }
    });

    const questions = await res.json();
    console.log("Testing formatKey on questions:");
    questions.forEach((q, idx) => {
      const formatted = formatKey(q.correct_answer, q.options, q.question_type || q.type);
      console.log(`Q#${idx + 1} | Type: ${q.question_type} | correct_answer: "${q.correct_answer}" | Formatted Key: "${formatted}"`);
    });
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();

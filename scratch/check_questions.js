const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  try {
    const { data: questions, error } = await supabase
      .from('questions')
      .select('*')
      .in('question_type', ['numerical_integer', 'numerical_decimal'])
      .limit(10);

    if (error) throw error;
    console.log("Found numerical questions count:", questions ? questions.length : 0);
    if (questions && questions.length > 0) {
      console.log("Sample question columns:", Object.keys(questions[0]));
      questions.forEach((q, idx) => {
        console.log(`\n[${idx + 1}] ID: ${q.id}`);
        console.log(`Type: ${q.question_type || q.type}`);
        console.log(`Content: ${q.question_text || q.text || q.content}`);
        console.log(`Correct Answer: ${q.correct_answer}`);
        console.log(`Options:`, q.options);
      });
    } else {
      console.log("No numerical questions found, querying all types of questions instead...");
      const { data: allQ, error: err2 } = await supabase.from('questions').select('*').limit(5);
      if (err2) throw err2;
      allQ.forEach((q, idx) => {
        console.log(`\n[${idx + 1}] ID: ${q.id}`);
        console.log(`Type: ${q.question_type || q.type}`);
        console.log(`Correct Answer: ${q.correct_answer}`);
      });
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();

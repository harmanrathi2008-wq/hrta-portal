const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("Missing Supabase credentials in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  try {
    const { data, error } = await supabase.from('exams').select('*').limit(1);
    if (error) throw error;
    if (data && data.length > 0) {
      console.log("Exams table columns:", Object.keys(data[0]));
    } else {
      console.log("No exams found.");
    }
    const { data: resData, error: resError } = await supabase.from('exam_results').select('*').limit(1);
    if (resError) throw resError;
    if (resData && resData.length > 0) {
      console.log("Exam results columns:", Object.keys(resData[0]));
    } else {
      console.log("No exam results found.");
    }
  } catch (err) {
    console.error("Error:", err.message);
  }
}

run();

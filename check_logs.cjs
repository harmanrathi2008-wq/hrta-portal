const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://jbutgoxjfghblyttywft.supabase.co';
const supabaseAnonKey = 'sb_publishable_a-0Lia3h1AUAdxRaflVprQ_x2RpLcKw';

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function run() {
  try {
    console.log("Inserting partial object to retrieve columns...");
    const { data, error } = await supabase.from('study_materials').insert({ title: 'Test Column Discovery' }).select();
    
    if (error) {
      console.error("Insert Error:", error.message);
    } else {
      console.log("Success! Columns:", Object.keys(data[0]));
      console.log("Full record:", data[0]);
      
      // Delete the test row
      const { error: delErr } = await supabase.from('study_materials').delete().eq('id', data[0].id);
      if (delErr) console.error("Clean up Error:", delErr.message);
      else console.log("Clean up successful!");
    }
  } catch (err) {
    console.error("Exception:", err.message);
  }
}

run();

const axios = require('axios');

const token = process.env.VITE_GEMINI_API_KEY || '';

async function run() {
  try {
    console.log("Calling Gemini API with Bearer Token...");
    // Call the direct Google Generative Language REST endpoint
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent';
    
    const response = await axios.post(
      url,
      {
        contents: [
          {
            parts: [
              { text: "Write a one-sentence physics question about gravity." }
            ]
          }
        ]
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log("Response text:", response.data.candidates[0].content.parts[0].text);
  } catch (err) {
    if (err.response) {
      console.error("Gemini call failed:", err.response.status, err.response.data);
    } else {
      console.error("Gemini call failed:", err.message);
    }
  }
}

run();

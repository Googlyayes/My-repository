import 'dotenv/config';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'Return exactly valid JSON with a single key: {"summary":"hello"}',
  config: {
    responseMimeType: 'application/json',
    maxOutputTokens: 256,
    temperature: 0.2,
  },
});

console.log('TYPE:', typeof response);
console.log('KEYS:', Object.keys(response || {}));
console.log('TEXT_RAW:', JSON.stringify(response?.text ?? 'NO_TEXT'));
console.log('CANDIDATES:', JSON.stringify(response?.candidates ?? null, null, 2));

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const DEFAULT_SYSTEM_PROMPT = `
You are LawTY, an Indian legal research assistant.

Return ONLY valid JSON with this exact schema:
{
  "summary": "2 short sentences",
  "procedural_history": ["step 1", "step 2", "step 3"],
  "statutes": [{ "act": "BNS / BNSS / BSA / relevant Central or state Act", "section": "Exact section or provision", "description": "1 short sentence", "penalties_or_exceptions": "1 short sentence" }],
  "precedents": [{ "title": "Case name", "court": "Court", "citation": "citation", "ratio": "1 short sentence" }],
  "procedural_strategy": ["strategy 1", "strategy 2"],
  "reading_material": [{ "label": "Document name", "url": "https://example.com" }]
}

Rules:
- Output valid JSON only.
- No markdown fences or commentary.
- Use current Indian legal framework only. Do not refer to IPC, CrPC, Evidence Act, or old colonial-era codes unless specifically relevant to historical context.
- Prefer BNS, BNSS, BSA, and the specific Act governing the matter.
- For each statute entry, include the relevant act name in the act field and the exact section/provision in the section field.
- Keep the entire response compact. Maximum 2 statutes and 4 precedents.
- Use the top 4 most relevant precedents for the issue.
- Keep strings short and factual.
- Stop immediately after the final closing brace.
`;

const FALLBACK_RESPONSE = {
  summary: 'Legal analysis could not be completed in the current response window. Please retry with a shorter factual query.',
  procedural_history: ['Facts were identified and issue framing was initiated.', 'The case needs a precise legal issue statement and statutory mapping.'],
  statutes: [],
  precedents: [],
  procedural_strategy: ['Clarify the exact legal issue and identify the controlling statute.', 'Map the facts to the offence elements before deciding the defence strategy.'],
  reading_material: [],
};

function extractJsonObject(rawText) {
  const value = String(rawText || '').trim();
  if (!value) return null;

  const trimmed = value.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = trimmed.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function normalizeResponseText(rawText) {
  if (typeof rawText === 'string') return rawText;
  if (!rawText) return '';

  if (typeof rawText.text === 'string') return rawText.text;
  if (Array.isArray(rawText.candidates)) {
    return rawText.candidates
      .map(candidate => candidate?.content?.parts || [])
      .flat()
      .map(part => typeof part?.text === 'string' ? part.text : '')
      .join('');
  }

  return String(rawText);
}

function parseJsonResponse(rawText, contextLabel) {
  const value = normalizeResponseText(rawText).trim();
  if (!value) {
    throw new Error(`${contextLabel}: Empty model response received.`);
  }

  const normalized = value.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();

  try {
    return JSON.parse(normalized);
  } catch {
    const recovered = extractJsonObject(normalized);
    if (recovered) return recovered;

    const snippet = normalized.slice(0, 800);
    console.error(`${contextLabel} JSON parse failed. Raw response snippet:`, snippet);
    throw new Error(`${contextLabel}: Response was truncated or invalid JSON.`);
  }
}

async function generateLawAnalysis(prompt) {
  const modelName = 'gemini-2.5-flash';

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: `Return compact valid JSON only for this legal issue: ${String(prompt)}`,
      config: {
        systemInstruction: DEFAULT_SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 768,
      },
    });

    return parseJsonResponse(response, 'Gemini structured response');
  } catch (error) {
    console.warn('Primary Gemini request failed, retrying with a final compact JSON prompt:', error?.message || error);

    try {
      const fallbackResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: `Return only compact JSON. Query: ${String(prompt)}`,
        config: {
          systemInstruction: DEFAULT_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          temperature: 0.1,
          maxOutputTokens: 768,
        },
      });

      return parseJsonResponse(fallbackResponse, 'Gemini fallback response');
    } catch (fallbackError) {
      console.error('Gemini fallback also failed. Returning stable default JSON instead.', fallbackError);
      return FALLBACK_RESPONSE;
    }
  }
}

app.post('/api/analyze', async (req, res) => {
  try {
    const { prompt, query } = req.body;
    const userPrompt = prompt || query;

    if (!userPrompt || !String(userPrompt).trim()) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const result = await generateLawAnalysis(String(userPrompt));
    return res.status(200).json(result);
  } catch (error) {
    console.error('Gemini API Error:', error);
    return res.status(500).json({
      error: error?.message || 'Failed to perform legal analysis.',
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`LawTY backend listening on http://localhost:${PORT}`));
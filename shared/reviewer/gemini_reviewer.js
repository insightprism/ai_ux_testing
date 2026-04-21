// Google Gemini reviewer adapter. REST call to generativelanguage.googleapis.com
// with inline image data. Returns the first JSON object found, or throws.

const { extractFirstJsonObject } = require('./claude_reviewer');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const ERROR_PAYLOAD_SNIPPET_CHARS = 600;
const RAW_OUTPUT_SNIPPET_CHARS = 400;

async function runReview({
  modelId,
  promptMarkdown,
  screenshots,
  dryRun = false,
  maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS,
}) {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey && !dryRun) {
    throw new Error('GOOGLE_API_KEY / GEMINI_API_KEY not set (check .env.local or fallback env)');
  }

  const requestParts = buildRequestParts(promptMarkdown, screenshots);
  const requestBody = {
    contents: [{ role: 'user', parts: requestParts }],
    generationConfig: {
      maxOutputTokens,
      responseMimeType: 'application/json',
    },
  };

  const requestUrl = `${GEMINI_BASE_URL}/${modelId}:generateContent?key=${apiKey || 'MISSING'}`;

  if (dryRun) {
    return {
      dryRun: true,
      url: requestUrl.replace(apiKey || 'MISSING', '<API_KEY>'),
      model: modelId,
      numImages: screenshots.length,
      approxPromptChars: promptMarkdown.length,
    };
  }

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Gemini API ${response.status}: ${responseBody.slice(0, ERROR_PAYLOAD_SNIPPET_CHARS)}`);
  }

  let parsedApiResponse;
  try {
    parsedApiResponse = JSON.parse(responseBody);
  } catch (error) {
    throw new Error(`Gemini returned non-JSON body: ${responseBody.slice(0, RAW_OUTPUT_SNIPPET_CHARS)}`);
  }

  const concatenatedText = (parsedApiResponse.candidates || [])
    .flatMap(candidate => (candidate.content && candidate.content.parts) || [])
    .filter(part => typeof part.text === 'string')
    .map(part => part.text)
    .join('\n');
  if (!concatenatedText) {
    throw new Error(`Gemini response had no text parts: ${JSON.stringify(parsedApiResponse).slice(0, RAW_OUTPUT_SNIPPET_CHARS)}`);
  }
  return extractFirstJsonObject(concatenatedText);
}

function buildRequestParts(promptMarkdown, screenshots) {
  const parts = [
    {
      text: 'You are the AI reviewer described in the prompt below. Read the attached screenshots, then return ONLY valid JSON matching the skeleton in the prompt — no preamble, no markdown fences, no commentary.',
    },
  ];
  for (const screenshot of screenshots) {
    parts.push({
      inline_data: {
        mime_type: screenshot.mediaType || 'image/png',
        data: screenshot.base64,
      },
    });
    parts.push({ text: `(above screenshot: ${screenshot.label || screenshot.path})` });
  }
  parts.push({ text: promptMarkdown });
  return parts;
}

module.exports = {
  runReview,
  review: runReview,
};

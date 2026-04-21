// Claude (Anthropic) reviewer adapter. Calls /v1/messages with vision content
// blocks. Returns the first JSON object found in the response, or throws.

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';
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
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey && !dryRun) {
    throw new Error('ANTHROPIC_API_KEY not set (check .env.local or fallback env)');
  }

  const messageContent = buildMessageContent(promptMarkdown, screenshots);
  const requestBody = {
    model: modelId,
    max_tokens: maxOutputTokens,
    messages: [{ role: 'user', content: messageContent }],
  };

  if (dryRun) {
    return {
      dryRun: true,
      url: ANTHROPIC_MESSAGES_URL,
      model: modelId,
      numImages: screenshots.length,
      approxPromptChars: promptMarkdown.length,
    };
  }

  const response = await fetch(ANTHROPIC_MESSAGES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify(requestBody),
  });

  const responseBody = await response.text();
  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}: ${responseBody.slice(0, ERROR_PAYLOAD_SNIPPET_CHARS)}`);
  }

  let parsedApiResponse;
  try {
    parsedApiResponse = JSON.parse(responseBody);
  } catch (error) {
    throw new Error(`Anthropic returned non-JSON body: ${responseBody.slice(0, RAW_OUTPUT_SNIPPET_CHARS)}`);
  }

  const concatenatedTextBlocks = (parsedApiResponse.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
  if (!concatenatedTextBlocks) {
    throw new Error(`Anthropic response had no text blocks: ${JSON.stringify(parsedApiResponse).slice(0, RAW_OUTPUT_SNIPPET_CHARS)}`);
  }

  return extractFirstJsonObject(concatenatedTextBlocks);
}

function buildMessageContent(promptMarkdown, screenshots) {
  const content = [
    {
      type: 'text',
      text: 'You are the AI reviewer described in the prompt below. Read the attached screenshots, then return ONLY valid JSON matching the skeleton in the prompt — no preamble, no markdown fences, no commentary.',
    },
  ];
  for (const screenshot of screenshots) {
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: screenshot.mediaType || 'image/png',
        data: screenshot.base64,
      },
    });
    content.push({
      type: 'text',
      text: `(above screenshot: ${screenshot.label || screenshot.path})`,
    });
  }
  content.push({ type: 'text', text: promptMarkdown });
  return content;
}

function extractFirstJsonObject(rawText) {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const firstBraceIndex = candidate.indexOf('{');
  const lastBraceIndex = candidate.lastIndexOf('}');
  if (firstBraceIndex < 0 || lastBraceIndex < 0 || lastBraceIndex <= firstBraceIndex) {
    throw new Error(`reviewer output contained no JSON object:\n${rawText.slice(0, ERROR_PAYLOAD_SNIPPET_CHARS)}`);
  }
  const jsonCandidate = candidate.slice(firstBraceIndex, lastBraceIndex + 1);
  try {
    return JSON.parse(jsonCandidate);
  } catch (error) {
    throw new Error(`reviewer JSON parse failed: ${error.message}\nraw:\n${jsonCandidate.slice(0, ERROR_PAYLOAD_SNIPPET_CHARS)}`);
  }
}

module.exports = {
  runReview,
  extractFirstJsonObject,
  // Back-compat shim so existing ai_ux_testing code using .review still works.
  review: runReview,
  extractJson: extractFirstJsonObject,
};

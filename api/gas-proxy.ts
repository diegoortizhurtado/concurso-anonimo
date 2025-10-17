import type { VercelRequest, VercelResponse } from '@vercel/node';

const GAS_BASE =
  'https://script.google.com/macros/s/AKfycbyHiEikjzV9zB6nF8Hz8-HkTm-9_mz9fN9IX6cjDo6bRseaftiXzH54zrrcAB4/exec';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const url = `${GAS_BASE}${req.url?.replace(/^\/api\/gas-proxy/, '') || ''}`;
  const method = req.method || 'GET';

  try {
    const response = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: method === 'POST' ? JSON.stringify(req.body) : undefined,
    });

    // 👇 lee la respuesta correctamente (no en streaming)
    const text = await response.text();

    // intenta parsear a JSON
    try {
      const json = JSON.parse(text);
      res.status(response.status).json(json);
    } catch {
      // si no era JSON, devuelve texto plano
      res.status(response.status).send(text);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('❌ Proxy error:', errMsg);
    res.status(500).json({ error: 'Proxy failed', detail: errMsg });
  }
}
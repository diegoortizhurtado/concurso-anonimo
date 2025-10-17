export const config = { runtime: "edge" };

export default async function handler(req: Request): Promise<Response> {
  const GAS_URL =
    "https://script.google.com/macros/s/AKfycbyHiEikjzV9zB6nF8Hz8-HkTm-9_mz9fN9IX6cjDo6bRseaftiXzH54zrrcAB4/exec";

  const method = req.method || "GET";
  const body = method === "POST" ? await req.text() : undefined;

  const res = await fetch(GAS_URL, {
    method,
    headers: { "Content-Type": "application/json" },
    body,
  });

  const text = await res.text();

  return new Response(text, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
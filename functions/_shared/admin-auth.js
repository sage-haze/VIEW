export function authoriseAdmin(request, env) {
  const expected = env.FX_REFRESH_TOKEN;
  if (!expected) {
    const error = new Error("FX_REFRESH_TOKEN is not configured.");
    error.status = 500;
    throw error;
  }

  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  if (supplied !== expected) {
    const error = new Error("Not authorised. Check the refresh token.");
    error.status = 401;
    throw error;
  }
}

export function errorResponse(error, fallback = "The request could not be completed.") {
  return Response.json({
    ok: false,
    error: error.publicMessage || error.message || fallback,
    diagnostics: error.diagnostics || null
  }, {
    status: error.status || 500,
    headers: { "Cache-Control": "no-store" }
  });
}

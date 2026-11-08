export function spotlightProfileSaveRequest(id, body) {
  const editing = Boolean(id);
  return {
    path: editing
      ? `/api/admin/spotlight/profile/${encodeURIComponent(id)}`
      : "/api/admin/spotlight/profile",
    init: {
      method: editing ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    }
  };
}

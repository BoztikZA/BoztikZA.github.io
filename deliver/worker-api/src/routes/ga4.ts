import type { Env } from "../types";
import { ga4Report, ga4Status } from "../lib/ga4";
import { error, json } from "./util";

/** GET /api/admin/analytics/ga4/...  — reached ONLY through handleAdmin, which has already verified the admin session
 *  (every admin route is authenticated, no exceptions). Read-only: any other method is refused.
 *    /status[?verify=1]        configuration state; verify=1 also proves the credentials against Google
 *    /<report>?period=…|from=…&to=…[&compare=0][&limit=&offset=][&refresh=1]
 *  `seg` is the path after "analytics/ga4". */
export async function routeGa4(request: Request, seg: string[], env: Env): Promise<Response> {
  if (request.method !== "GET") return error("Method not allowed", 405);
  const q = new URL(request.url).searchParams;
  const name = seg[0];
  if (seg.length > 1) return error("Not found", 404);
  if (!name || name === "status") return json({ ok: true, ...(await ga4Status(env, q.get("verify") === "1")) });
  return json({ ok: true, ...(await ga4Report(env, name, q)) });
}

import { doAction } from "../../../lib/chain";

export const dynamic = "force-dynamic";

export async function POST(req) {
  try {
    const { action, params } = await req.json();
    return Response.json(await doAction(action, params || {}));
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
